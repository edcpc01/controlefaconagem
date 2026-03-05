import { db } from './firebase'
import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, orderBy, Timestamp, writeBatch
} from 'firebase/firestore'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ──────────────────────────────────────────────────────────
// CONSTANTES DE NEGÓCIO
// ──────────────────────────────────────────────────────────

export const TIPOS_COM_ABATIMENTO = ['faturamento', 'sucata', 'estopa']

export const TIPOS_SAIDA = [
  { value: 'faturamento',        label: 'Faturamento' },
  { value: 'dev_qualidade',      label: 'Devolução Qualidade' },
  { value: 'dev_processo',       label: 'Devolução Processo' },
  { value: 'dev_final_campanha', label: 'Devolução Final de Campanha' },
  { value: 'sucata',             label: 'Sucata' },
  { value: 'estopa',             label: 'Estopa' },
]

export const PERCENTUAL_ABATIMENTO = 0.015

export function calcularVolumeAbatido(volumeBruto, tipoSaida) {
  if (TIPOS_COM_ABATIMENTO.includes(tipoSaida)) {
    return volumeBruto * (1 - PERCENTUAL_ABATIMENTO)
  }
  return volumeBruto
}

function tsToISO(ts) {
  if (!ts) return null
  if (ts instanceof Timestamp) return ts.toDate().toISOString().split('T')[0]
  if (ts && ts.seconds) return new Date(ts.seconds * 1000).toISOString().split('T')[0]
  return ts
}

function docToObj(snap) {
  const d = snap.data()
  return {
    id: snap.id,
    ...d,
    data_emissao:  tsToISO(d.data_emissao),
    criado_em:     d.criado_em ? (d.criado_em.toDate ? d.criado_em.toDate().toISOString() : d.criado_em) : null,
    atualizado_em: d.atualizado_em ? (d.atualizado_em.toDate ? d.atualizado_em.toDate().toISOString() : d.atualizado_em) : null,
  }
}

// ──────────────────────────────────────────────────────────
// NF ENTRADA
// ──────────────────────────────────────────────────────────

export async function listarNFsEntrada() {
  const q = query(collection(db, 'nf_entrada'), orderBy('data_emissao', 'asc'))
  const snap = await getDocs(q)
  return snap.docs.map(docToObj)
}

export async function criarNFEntrada(payload) {
  const now = Timestamp.now()
  const docRef = await addDoc(collection(db, 'nf_entrada'), {
    numero_nf:       payload.numero_nf,
    data_emissao:    Timestamp.fromDate(new Date(payload.data_emissao + 'T12:00:00')),
    codigo_material: payload.codigo_material,
    lote:            payload.lote,
    volume_kg:       payload.volume_kg,
    volume_saldo_kg: payload.volume_kg,
    valor_unitario:  payload.valor_unitario,
    criado_em:       now,
    atualizado_em:   now,
  })
  const snap = await getDoc(docRef)
  return docToObj(snap)
}

export async function deletarNFEntrada(id) {
  await deleteDoc(doc(db, 'nf_entrada', id))
}

// ──────────────────────────────────────────────────────────
// SAÍDA COM ALOCAÇÃO FIFO
// ──────────────────────────────────────────────────────────

export async function criarSaida(payload) {
  const { romaneio_microdata, codigo_produto, lote_produto, tipo_saida, volume_bruto_kg } = payload

  const temAbatimento = TIPOS_COM_ABATIMENTO.includes(tipo_saida)
  const volume_abatido_kg = calcularVolumeAbatido(volume_bruto_kg, tipo_saida)
  const percentual_abatimento = temAbatimento ? PERCENTUAL_ABATIMENTO : 0

  // Buscar todas NFs ordenadas por data de emissão e filtrar com saldo em memória
  const snap = await getDocs(query(collection(db, 'nf_entrada'), orderBy('data_emissao', 'asc')))
  const nfsComSaldo = snap.docs.map(docToObj).filter(nf => Number(nf.volume_saldo_kg) > 0.001)

  // Calcular alocações FIFO
  let volumeRestante = volume_abatido_kg
  const alocacoes = []

  for (const nf of nfsComSaldo) {
    if (volumeRestante <= 0) break
    const alocar = Math.min(Number(nf.volume_saldo_kg), volumeRestante)
    alocacoes.push({
      nf_entrada_id:    nf.id,
      numero_nf:        nf.numero_nf,
      data_emissao:     nf.data_emissao,
      volume_alocado_kg: alocar,
    })
    volumeRestante -= alocar
  }

  if (volumeRestante > 0.01) {
    throw new Error(`Saldo insuficiente nas NFs de entrada. Faltam ${volumeRestante.toFixed(4)} kg.`)
  }

  const now = Timestamp.now()
  const batch = writeBatch(db)

  // 1) Criar documento de saída
  const saidaRef = doc(collection(db, 'saida'))
  batch.set(saidaRef, {
    romaneio_microdata,
    codigo_produto,
    lote_produto,
    tipo_saida,
    volume_bruto_kg,
    volume_abatido_kg,
    percentual_abatimento,
    criado_em: now,
  })

  // 2) Criar alocações
  const alocacoesRetorno = []
  for (const aloc of alocacoes) {
    const alocRef = doc(collection(db, 'alocacao_saida'))
    const alocData = {
      saida_id:          saidaRef.id,
      nf_entrada_id:     aloc.nf_entrada_id,
      numero_nf:         aloc.numero_nf,
      data_emissao:      aloc.data_emissao,
      volume_alocado_kg: aloc.volume_alocado_kg,
      criado_em:         now,
    }
    batch.set(alocRef, alocData)
    alocacoesRetorno.push({ id: alocRef.id, ...alocData })
  }

  // 3) Atualizar saldos das NFs
  for (const aloc of alocacoes) {
    const nfOriginal = nfsComSaldo.find(n => n.id === aloc.nf_entrada_id)
    const novoSaldo = Number(nfOriginal.volume_saldo_kg) - aloc.volume_alocado_kg
    batch.update(doc(db, 'nf_entrada', aloc.nf_entrada_id), {
      volume_saldo_kg: novoSaldo,
      atualizado_em: now,
    })
  }

  await batch.commit()

  return {
    saida: {
      id: saidaRef.id,
      romaneio_microdata,
      codigo_produto,
      lote_produto,
      tipo_saida,
      volume_bruto_kg,
      volume_abatido_kg,
      percentual_abatimento,
      criado_em: now.toDate().toISOString(),
    },
    alocacoes: alocacoesRetorno,
  }
}

export async function listarSaidas() {
  const [saidasSnap, alocacoesSnap] = await Promise.all([
    getDocs(query(collection(db, 'saida'), orderBy('criado_em', 'desc'))),
    getDocs(collection(db, 'alocacao_saida')),
  ])

  const alocPorSaida = {}
  alocacoesSnap.docs.forEach(d => {
    const data = d.data()
    if (!alocPorSaida[data.saida_id]) alocPorSaida[data.saida_id] = []
    alocPorSaida[data.saida_id].push({ id: d.id, ...data })
  })

  return saidasSnap.docs.map(d => {
    const data = d.data()
    return {
      id: d.id,
      ...data,
      criado_em: data.criado_em?.toDate ? data.criado_em.toDate().toISOString() : data.criado_em,
      alocacao_saida: alocPorSaida[d.id] || [],
    }
  })
}

// ──────────────────────────────────────────────────────────
// GERAÇÃO DE ROMANEIO PDF
// ──────────────────────────────────────────────────────────

export function gerarRomaneioPDF(saida, alocacoes) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const azulEscuro = [15, 40, 80]
  const azulMedio  = [26, 80, 150]
  const azulClaro  = [220, 235, 255]
  const branco     = [255, 255, 255]

  doc.setFillColor(...azulEscuro)
  doc.rect(0, 0, W, 38, 'F')
  doc.setTextColor(...branco)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('RHODIA SANTO ANDRÉ', W / 2, 13, { align: 'center' })
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text('ROMANEIO DE SAÍDA — FAÇONAGEM', W / 2, 21, { align: 'center' })
  doc.setFontSize(9)
  doc.text(`Emitido em: ${format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`, W / 2, 29, { align: 'center' })
  doc.setDrawColor(...azulMedio)
  doc.setLineWidth(0.5)
  doc.line(14, 40, W - 14, 40)

  let y = 48
  const tipoLabel = TIPOS_SAIDA.find(t => t.value === saida.tipo_saida)?.label || saida.tipo_saida
  const temAbatimento = TIPOS_COM_ABATIMENTO.includes(saida.tipo_saida)

  doc.setFillColor(...azulClaro)
  doc.roundedRect(14, y - 5, W - 28, 52, 3, 3, 'F')

  const campos = [
    ['Romaneio Microdata', saida.romaneio_microdata],
    ['Código do Produto',  saida.codigo_produto],
    ['Lote do Produto',    saida.lote_produto],
    ['Tipo de Saída',      tipoLabel],
  ]

  campos.forEach(([label, value], i) => {
    const col = i % 2 === 0 ? 20 : W / 2 + 6
    const row = y + Math.floor(i / 2) * 10
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(80, 80, 80)
    doc.text(label + ':', col, row)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...azulEscuro)
    doc.text(String(value), col + 44, row)
  })

  y += 22

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(80, 80, 80)
  doc.text('Volume Bruto:', 20, y)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...azulEscuro)
  doc.text(`${Number(saida.volume_bruto_kg).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} kg`, 64, y)

  if (temAbatimento) {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(80, 80, 80)
    doc.text('Volume c/ Abatimento (1,5%):', W / 2 + 6, y)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...azulMedio)
    doc.text(`${Number(saida.volume_abatido_kg).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} kg`, W / 2 + 62, y)
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(80, 80, 80)
    doc.text('Volume Final:', W / 2 + 6, y)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...azulMedio)
    doc.text(`${Number(saida.volume_abatido_kg).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} kg`, W / 2 + 36, y)
  }

  y += 18

  doc.setFillColor(...azulEscuro)
  doc.setTextColor(...branco)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.roundedRect(14, y - 6, W - 28, 10, 2, 2, 'F')
  doc.text('ALOCAÇÃO NAS NFs DE ENTRADA (FIFO)', W / 2, y, { align: 'center' })
  y += 8

  autoTable(doc, {
    startY: y,
    margin: { left: 14, right: 14 },
    head: [['NF de Entrada', 'Data de Emissão', 'Volume Abatido (kg)']],
    body: alocacoes.map(a => [
      a.numero_nf,
      a.data_emissao ? format(new Date(a.data_emissao), 'dd/MM/yyyy') : '—',
      Number(a.volume_alocado_kg).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }),
    ]),
    foot: [[
      { content: 'TOTAL', styles: { fontStyle: 'bold' } },
      '',
      {
        content: alocacoes.reduce((acc, a) => acc + Number(a.volume_alocado_kg), 0)
          .toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + ' kg',
        styles: { fontStyle: 'bold' },
      },
    ]],
    headStyles:         { fillColor: azulMedio, textColor: branco, fontStyle: 'bold', fontSize: 10 },
    bodyStyles:         { textColor: [30, 30, 60], fontSize: 9 },
    footStyles:         { fillColor: azulClaro, textColor: azulEscuro, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [240, 246, 255] },
    columnStyles:       { 2: { halign: 'right' } },
  })

  const pageH = doc.internal.pageSize.height
  doc.setFillColor(...azulEscuro)
  doc.rect(0, pageH - 14, W, 14, 'F')
  doc.setTextColor(...branco)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('Rhodia Santo André — Sistema de Controle de Façonagem', W / 2, pageH - 5, { align: 'center' })

  const filename = `romaneio_${saida.romaneio_microdata}_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`
  doc.save(filename)
}
