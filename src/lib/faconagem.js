import { db } from './firebase'
import {
  collection, doc, addDoc, getDoc, getDocs, deleteDoc, updateDoc,
  query, where, orderBy, Timestamp, writeBatch, runTransaction, setDoc
} from 'firebase/firestore'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import * as XLSX from 'xlsx'

// ─────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────

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

export function calcularVolumeAbatido(volumeLiquido, tipoSaida) {
  // O campo agora é "volume líquido" — o abatimento ainda se aplica sobre ele
  return TIPOS_COM_ABATIMENTO.includes(tipoSaida)
    ? volumeLiquido * (1 - PERCENTUAL_ABATIMENTO)
    : volumeLiquido
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

function tsToISO(ts) {
  if (!ts) return null
  if (ts instanceof Timestamp) return ts.toDate().toISOString().split('T')[0]
  if (ts?.seconds) return new Date(ts.seconds * 1000).toISOString().split('T')[0]
  return ts
}

function tsToDateTime(ts) {
  if (!ts) return null
  if (ts?.toDate) return ts.toDate().toISOString()
  return ts
}

function docToObj(snap) {
  const d = snap.data()
  return {
    id: snap.id, ...d,
    data_emissao:  tsToISO(d.data_emissao),
    criado_em:     tsToDateTime(d.criado_em),
    atualizado_em: tsToDateTime(d.atualizado_em),
  }
}

// ─────────────────────────────────────────────────────────────────
// LOG DE AÇÕES
// ─────────────────────────────────────────────────────────────────

export async function registrarLog(acao, descricao, usuario) {
  try {
    await addDoc(collection(db, 'log_acoes'), {
      acao, descricao,
      usuario_email: usuario?.email || 'desconhecido',
      usuario_nome:  usuario?.displayName || usuario?.email || 'desconhecido',
      criado_em:     Timestamp.now(),
    })
  } catch (_) {}
}

export async function listarLogs() {
  const snap = await getDocs(query(collection(db, 'log_acoes'), orderBy('criado_em', 'desc')))
  return snap.docs.map(d => ({ id: d.id, ...d.data(), criado_em: tsToDateTime(d.data().criado_em) }))
}

// ─────────────────────────────────────────────────────────────────
// CONFIGURAÇÕES
// ─────────────────────────────────────────────────────────────────

export async function salvarConfig(payload) {
  await setDoc(doc(db, 'config', 'app'), payload, { merge: true })
}

export async function carregarConfig() {
  const snap = await getDoc(doc(db, 'config', 'app'))
  return snap.exists() ? snap.data() : {}
}

// ─────────────────────────────────────────────────────────────────
// NF ENTRADA — CRUD + EDIÇÃO
// ─────────────────────────────────────────────────────────────────

export async function listarNFsEntrada() {
  const snap = await getDocs(query(collection(db, 'nf_entrada'), orderBy('data_emissao', 'asc')))
  return snap.docs.map(docToObj)
}

export async function criarNFEntrada(payload, usuario) {
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
  await registrarLog('NF_ENTRADA_CRIADA', `NF ${payload.numero_nf} — ${payload.volume_kg} kg`, usuario)
  const snap = await getDoc(docRef)
  return docToObj(snap)
}

export async function editarNFEntrada(id, payload, usuario) {
  const now = Timestamp.now()
  // Calcula novo saldo: ajusta proporcionalmente se volume mudou
  const snapAtual = await getDoc(doc(db, 'nf_entrada', id))
  if (!snapAtual.exists()) throw new Error('NF não encontrada.')
  const atual = snapAtual.data()
  const consumido = Number(atual.volume_kg) - Number(atual.volume_saldo_kg)
  const novoSaldo = Math.max(0, payload.volume_kg - consumido)

  await updateDoc(doc(db, 'nf_entrada', id), {
    numero_nf:       payload.numero_nf,
    data_emissao:    Timestamp.fromDate(new Date(payload.data_emissao + 'T12:00:00')),
    codigo_material: payload.codigo_material,
    lote:            payload.lote,
    volume_kg:       payload.volume_kg,
    volume_saldo_kg: novoSaldo,
    valor_unitario:  payload.valor_unitario,
    atualizado_em:   now,
  })
  await registrarLog('NF_ENTRADA_EDITADA', `NF ${payload.numero_nf} atualizada`, usuario)
}

export async function deletarNFEntrada(id, numeroNF, usuario) {
  await deleteDoc(doc(db, 'nf_entrada', id))
  await registrarLog('NF_ENTRADA_REMOVIDA', `NF ${numeroNF} removida`, usuario)
}

export async function buscarAlocacoesPorNF(nfId) {
  const alocSnap = await getDocs(
    query(collection(db, 'alocacao_saida'), where('nf_entrada_id', '==', nfId), orderBy('criado_em', 'asc'))
  )
  if (alocSnap.empty) return []
  const saidaIds = [...new Set(alocSnap.docs.map(d => d.data().saida_id))]
  const saidasMap = {}
  await Promise.all(saidaIds.map(async (sid) => {
    const sSnap = await getDoc(doc(db, 'saida', sid))
    if (sSnap.exists()) {
      const d = sSnap.data()
      saidasMap[sid] = { id: sSnap.id, ...d, criado_em: tsToDateTime(d.criado_em) }
    }
  }))
  return alocSnap.docs.map(d => {
    const aloc = d.data()
    return { id: d.id, ...aloc, criado_em: tsToDateTime(aloc.criado_em), saida: saidasMap[aloc.saida_id] || null }
  })
}

// ─────────────────────────────────────────────────────────────────
// EXTRAÇÃO DE DADOS DA NF PDF (via Claude API)
// ─────────────────────────────────────────────────────────────────

export async function extrairDadosNFdoPDF(base64Data) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64Data }
          },
          {
            type: 'text',
            text: `Extraia os dados desta Nota Fiscal e retorne APENAS um JSON válido, sem texto adicional, sem markdown, sem explicações:
{
  "numero_nf": "número da NF (apenas dígitos, sem zeros à esquerda desnecessários)",
  "data_emissao": "data no formato YYYY-MM-DD",
  "codigo_material": "código do produto/material (campo COD da tabela de produtos)",
  "lote": "lote do produto (campo Lote/Qtd ou LOTE nos dados adicionais, apenas o código do lote sem a quantidade)",
  "volume_kg": número em ponto flutuante do peso líquido em kg,
  "valor_unitario": número em ponto flutuante do valor unitário
}
Retorne SOMENTE o JSON, nada mais.`
          }
        ]
      }]
    })
  })
  const data = await response.json()
  const text = data.content?.map(c => c.text || '').join('').trim()
  const clean = text.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}

// ─────────────────────────────────────────────────────────────────
// PREVIEW FIFO (sem gravar — usado para confirmação)
// ─────────────────────────────────────────────────────────────────

export async function previewFIFO(volumeAbatido) {
  const snap = await getDocs(query(collection(db, 'nf_entrada'), orderBy('data_emissao', 'asc')))
  const nfsComSaldo = snap.docs.map(docToObj).filter(nf => Number(nf.volume_saldo_kg) > 0.001)
  let restante = volumeAbatido
  const preview = []
  for (const nf of nfsComSaldo) {
    if (restante <= 0) break
    const alocar = Math.min(Number(nf.volume_saldo_kg), restante)
    preview.push({ numero_nf: nf.numero_nf, data_emissao: nf.data_emissao, saldo_atual: nf.volume_saldo_kg, volume_alocado_kg: alocar })
    restante -= alocar
  }
  return { preview, saldoInsuficiente: restante > 0.01, faltando: restante }
}

// ─────────────────────────────────────────────────────────────────
// SAÍDA COM ALOCAÇÃO FIFO
// ─────────────────────────────────────────────────────────────────

export async function criarSaida(payload, usuario) {
  const {
    romaneio_microdata, codigo_produto, lote_poy, lote_acabado,
    tipo_saida, volume_liquido_kg, volume_bruto_kg, quantidade
  } = payload

  const temAbatimento     = TIPOS_COM_ABATIMENTO.includes(tipo_saida)
  // O volume que será debitado do estoque = volume líquido com abatimento aplicado
  const volume_abatido_kg = calcularVolumeAbatido(volume_liquido_kg, tipo_saida)
  const percentual_abatimento = temAbatimento ? PERCENTUAL_ABATIMENTO : 0

  const snap = await getDocs(query(collection(db, 'nf_entrada'), orderBy('data_emissao', 'asc')))
  const nfsComSaldo = snap.docs.map(docToObj).filter(nf => Number(nf.volume_saldo_kg) > 0.001)

  let volumeRestante = volume_abatido_kg
  const alocacoes = []
  for (const nf of nfsComSaldo) {
    if (volumeRestante <= 0) break
    const alocar = Math.min(Number(nf.volume_saldo_kg), volumeRestante)
    alocacoes.push({ nf_entrada_id: nf.id, numero_nf: nf.numero_nf, data_emissao: nf.data_emissao, volume_alocado_kg: alocar })
    volumeRestante -= alocar
  }

  if (volumeRestante > 0.01)
    throw new Error(`Saldo insuficiente. Faltam ${volumeRestante.toFixed(4)} kg.`)

  const now      = Timestamp.now()
  const batch    = writeBatch(db)
  const saidaRef = doc(collection(db, 'saida'))

  batch.set(saidaRef, {
    romaneio_microdata,
    codigo_produto,
    lote_poy,
    lote_acabado:    lote_acabado || '',
    tipo_saida,
    volume_liquido_kg,
    volume_bruto_kg:  volume_bruto_kg || null,
    quantidade:       quantidade || null,
    volume_abatido_kg,
    percentual_abatimento,
    usuario_email: usuario?.email || '',
    criado_em: now,
  })

  const alocacoesRetorno = []
  for (const aloc of alocacoes) {
    const alocRef  = doc(collection(db, 'alocacao_saida'))
    const alocData = {
      saida_id: saidaRef.id, nf_entrada_id: aloc.nf_entrada_id,
      numero_nf: aloc.numero_nf, data_emissao: aloc.data_emissao,
      volume_alocado_kg: aloc.volume_alocado_kg, criado_em: now
    }
    batch.set(alocRef, alocData)
    alocacoesRetorno.push({ id: alocRef.id, ...alocData })
  }

  for (const aloc of alocacoes) {
    const nfOrig    = nfsComSaldo.find(n => n.id === aloc.nf_entrada_id)
    const novoSaldo = Number(nfOrig.volume_saldo_kg) - aloc.volume_alocado_kg
    batch.update(doc(db, 'nf_entrada', aloc.nf_entrada_id), { volume_saldo_kg: novoSaldo, atualizado_em: now })
  }

  await batch.commit()
  await registrarLog(
    'SAIDA_REGISTRADA',
    `Romaneio ${romaneio_microdata} — ${volume_abatido_kg.toFixed(4)} kg (${TIPOS_SAIDA.find(t=>t.value===tipo_saida)?.label})`,
    usuario
  )

  return {
    saida: {
      id: saidaRef.id, romaneio_microdata, codigo_produto, lote_poy, lote_acabado,
      tipo_saida, volume_liquido_kg, volume_bruto_kg, quantidade,
      volume_abatido_kg, percentual_abatimento,
      criado_em: now.toDate().toISOString()
    },
    alocacoes: alocacoesRetorno,
  }
}

export async function listarSaidas() {
  const [saidasSnap, alocSnap] = await Promise.all([
    getDocs(query(collection(db, 'saida'), orderBy('criado_em', 'desc'))),
    getDocs(collection(db, 'alocacao_saida')),
  ])
  const alocPorSaida = {}
  alocSnap.docs.forEach(d => {
    const data = d.data()
    if (!alocPorSaida[data.saida_id]) alocPorSaida[data.saida_id] = []
    alocPorSaida[data.saida_id].push({ id: d.id, ...data })
  })
  return saidasSnap.docs.map(d => {
    const data = d.data()
    return { id: d.id, ...data, criado_em: tsToDateTime(d.data().criado_em), alocacao_saida: alocPorSaida[d.id] || [] }
  })
}

// ─────────────────────────────────────────────────────────────────
// EXPORTAÇÃO EXCEL (.xlsx)
// ─────────────────────────────────────────────────────────────────

function tipoLabel(v) { return TIPOS_SAIDA.find(t => t.value === v)?.label || v }
function fmtNum(n, dec = 4) { return n != null ? Number(n).toFixed(dec).replace('.', ',') : '' }
function fmtDate(d) { try { return format(new Date(d), 'dd/MM/yyyy') } catch { return '' } }
function fmtDateTime(d) { try { return format(new Date(d), 'dd/MM/yyyy HH:mm') } catch { return '' } }

export function exportarExcel(nfs, saidas) {
  const wb = XLSX.utils.book_new()

  // Aba 1: NFs de Entrada
  const nfRows = nfs.map(nf => ({
    'Número NF':        nf.numero_nf,
    'Data Emissão':     fmtDate(nf.data_emissao),
    'Cód. Material':    nf.codigo_material,
    'Lote POY':         nf.lote,
    'Volume Total (kg)': fmtNum(nf.volume_kg),
    'Saldo (kg)':       fmtNum(nf.volume_saldo_kg),
    'Consumido (kg)':   fmtNum(Number(nf.volume_kg) - Number(nf.volume_saldo_kg)),
    'V. Unitário (R$)': fmtNum(nf.valor_unitario, 6),
    'Valor Total (R$)': fmtNum(Number(nf.volume_kg) * Number(nf.valor_unitario), 2),
    'Status':           Number(nf.volume_saldo_kg) <= 0.01 ? 'Zerada' : 'Ativa',
  }))
  const wsNF = XLSX.utils.json_to_sheet(nfRows)
  wsNF['!cols'] = [14,12,14,12,16,12,14,16,14,8].map(w => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, wsNF, 'NFs Entrada')

  // Aba 2: Saídas
  const saidaRows = saidas.map(s => ({
    'Romaneio Microdata': s.romaneio_microdata,
    'Cód. Produto':       s.codigo_produto,
    'Lote POY':           s.lote_poy || s.lote_produto || '',
    'Lote Acabado':       s.lote_acabado || '',
    'Tipo Saída':         tipoLabel(s.tipo_saida),
    'Vol. Líquido (kg)':  fmtNum(s.volume_liquido_kg || s.volume_bruto_kg),
    'Vol. Bruto (kg)':    fmtNum(s.volume_bruto_kg),
    'Quantidade':         s.quantidade || '',
    'Vol. Final (kg)':    fmtNum(s.volume_abatido_kg),
    'Abatimento':         TIPOS_COM_ABATIMENTO.includes(s.tipo_saida) ? '1,5%' : '0%',
    'Data/Hora':          fmtDateTime(s.criado_em),
    'Usuário':            s.usuario_email || '',
    'NFs Abatidas':       (s.alocacao_saida || []).map(a => `NF ${a.numero_nf}: ${fmtNum(a.volume_alocado_kg)} kg`).join(' | '),
  }))
  const wsSaida = XLSX.utils.json_to_sheet(saidaRows)
  wsSaida['!cols'] = [16,12,12,12,22,14,12,10,14,10,16,22,50].map(w => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, wsSaida, 'Saídas')

  // Aba 3: Alocações FIFO
  const alocRows = []
  saidas.forEach(s => {
    ;(s.alocacao_saida || []).forEach(a => {
      alocRows.push({
        'Romaneio':             s.romaneio_microdata,
        'Tipo Saída':           tipoLabel(s.tipo_saida),
        'NF Entrada':           a.numero_nf,
        'Emissão NF':           fmtDate(a.data_emissao),
        'Volume Alocado (kg)':  fmtNum(a.volume_alocado_kg),
        'Data Saída':           fmtDateTime(s.criado_em),
      })
    })
  })
  const wsAloc = XLSX.utils.json_to_sheet(alocRows)
  wsAloc['!cols'] = [16,22,12,12,18,16].map(w => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, wsAloc, 'Alocações FIFO')

  const ts = format(new Date(), 'yyyyMMdd_HHmm')
  XLSX.writeFile(wb, `faconagem_rhodia_${ts}.xlsx`)
}

// ─────────────────────────────────────────────────────────────────
// ROMANEIO PDF (com logo)
// ─────────────────────────────────────────────────────────────────

export function gerarRomaneioPDF(saida, alocacoes, config = {}) {
  const pdoc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W      = 210
  const AZ_ESC = [15, 40, 80]
  const AZ_MED = [26, 80, 150]
  const AZ_CLR = [220, 235, 255]
  const BRANCO = [255, 255, 255]
  const headerH = config.logoBase64 ? 46 : 38

  // Cabeçalho
  pdoc.setFillColor(...AZ_ESC)
  pdoc.rect(0, 0, W, headerH, 'F')

  if (config.logoBase64) {
    try { pdoc.addImage(config.logoBase64, 'PNG', 14, 6, 32, 32) } catch (_) {}
  }

  pdoc.setTextColor(...BRANCO)
  pdoc.setFontSize(18); pdoc.setFont('helvetica', 'bold')
  pdoc.text('RHODIA SANTO ANDRÉ', W / 2, 14, { align: 'center' })
  pdoc.setFontSize(11); pdoc.setFont('helvetica', 'normal')
  pdoc.text('ROMANEIO DE SAÍDA — FAÇONAGEM', W / 2, 22, { align: 'center' })
  pdoc.setFontSize(9)
  pdoc.text(`Emitido em: ${format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`, W / 2, 30, { align: 'center' })

  pdoc.setDrawColor(...AZ_MED); pdoc.setLineWidth(0.5)
  pdoc.line(14, headerH + 2, W - 14, headerH + 2)

  const tipoLbl = TIPOS_SAIDA.find(t => t.value === saida.tipo_saida)?.label || saida.tipo_saida
  const temAbat = TIPOS_COM_ABATIMENTO.includes(saida.tipo_saida)
  let y = headerH + 12

  // Box dados principais
  pdoc.setFillColor(...AZ_CLR)
  pdoc.roundedRect(14, y - 5, W - 28, 62, 3, 3, 'F')

  const campos = [
    ['Romaneio Microdata', saida.romaneio_microdata],
    ['Código do Produto',  saida.codigo_produto],
    ['Lote POY',           saida.lote_poy || saida.lote_produto || '—'],
    ['Tipo de Saída',      tipoLbl],
  ]
  campos.forEach(([lbl, val], i) => {
    const col = i % 2 === 0 ? 20 : W / 2 + 6
    const row = y + Math.floor(i / 2) * 10
    pdoc.setFont('helvetica', 'bold'); pdoc.setTextColor(80, 80, 80)
    pdoc.text(lbl + ':', col, row)
    pdoc.setFont('helvetica', 'normal'); pdoc.setTextColor(...AZ_ESC)
    pdoc.text(String(val ?? '—'), col + 44, row)
  })

  y += 22

  // Lote Acabado e Quantidade (se preenchidos)
  if (saida.lote_acabado) {
    pdoc.setFont('helvetica', 'bold'); pdoc.setTextColor(80, 80, 80)
    pdoc.text('Lote Acabado:', 20, y)
    pdoc.setFont('helvetica', 'normal'); pdoc.setTextColor(...AZ_ESC)
    pdoc.text(String(saida.lote_acabado), 64, y)
  }
  if (saida.quantidade) {
    pdoc.setFont('helvetica', 'bold'); pdoc.setTextColor(80, 80, 80)
    pdoc.text('Quantidade:', W / 2 + 6, y)
    pdoc.setFont('helvetica', 'normal'); pdoc.setTextColor(...AZ_ESC)
    pdoc.text(String(saida.quantidade), W / 2 + 36, y)
  }
  if (saida.lote_acabado || saida.quantidade) y += 10

  // Volumes
  const fmtKg = n => n != null ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '—'

  pdoc.setFont('helvetica', 'bold'); pdoc.setTextColor(80, 80, 80)
  pdoc.text('Volume Líquido:', 20, y)
  pdoc.setFont('helvetica', 'normal'); pdoc.setTextColor(...AZ_ESC)
  pdoc.text(`${fmtKg(saida.volume_liquido_kg || saida.volume_bruto_kg)} kg`, 64, y)

  if (saida.volume_bruto_kg && saida.volume_bruto_kg !== saida.volume_liquido_kg) {
    pdoc.setFont('helvetica', 'bold'); pdoc.setTextColor(80, 80, 80)
    pdoc.text('Volume Bruto:', W / 2 + 6, y)
    pdoc.setFont('helvetica', 'normal'); pdoc.setTextColor(...AZ_ESC)
    pdoc.text(`${fmtKg(saida.volume_bruto_kg)} kg`, W / 2 + 38, y)
    y += 10
  }

  if (temAbat) {
    pdoc.setFont('helvetica', 'bold'); pdoc.setTextColor(80, 80, 80)
    pdoc.text('Com Abatimento (1,5%):', 20, y)
    pdoc.setFont('helvetica', 'bold'); pdoc.setTextColor(...AZ_MED)
    pdoc.text(`${fmtKg(saida.volume_abatido_kg)} kg`, 76, y)
    y += 10
  }

  y += 8

  // Tabela FIFO
  pdoc.setFillColor(...AZ_ESC); pdoc.setTextColor(...BRANCO)
  pdoc.setFontSize(11); pdoc.setFont('helvetica', 'bold')
  pdoc.roundedRect(14, y - 6, W - 28, 10, 2, 2, 'F')
  pdoc.text('ALOCAÇÃO NAS NFs DE ENTRADA (FIFO)', W / 2, y, { align: 'center' })
  y += 8

  autoTable(pdoc, {
    startY: y, margin: { left: 14, right: 14 },
    head: [['NF de Entrada', 'Data de Emissão', 'Volume Abatido (kg)']],
    body: alocacoes.map(a => [
      a.numero_nf,
      a.data_emissao ? format(new Date(a.data_emissao), 'dd/MM/yyyy') : '—',
      fmtKg(a.volume_alocado_kg),
    ]),
    foot: [[
      { content: 'TOTAL', styles: { fontStyle: 'bold' } }, '',
      { content: fmtKg(alocacoes.reduce((s, a) => s + Number(a.volume_alocado_kg), 0)) + ' kg', styles: { fontStyle: 'bold' } },
    ]],
    headStyles:         { fillColor: AZ_MED, textColor: BRANCO, fontStyle: 'bold', fontSize: 10 },
    bodyStyles:         { textColor: [30, 30, 60], fontSize: 9 },
    footStyles:         { fillColor: AZ_CLR, textColor: AZ_ESC, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [240, 246, 255] },
    columnStyles:       { 2: { halign: 'right' } },
  })

  // Assinatura
  const finalY = pdoc.lastAutoTable.finalY + 16
  pdoc.setDrawColor(...AZ_MED); pdoc.setLineWidth(0.3)
  pdoc.line(14, finalY + 10, 90, finalY + 10)
  pdoc.line(120, finalY + 10, W - 14, finalY + 10)
  pdoc.setFontSize(8); pdoc.setTextColor(100, 100, 100); pdoc.setFont('helvetica', 'normal')
  pdoc.text('Responsável pela Saída', 52, finalY + 15, { align: 'center' })
  pdoc.text('Conferente / Aprovação', W - 14 - 31, finalY + 15, { align: 'center' })

  // Rodapé
  const pH = pdoc.internal.pageSize.height
  pdoc.setFillColor(...AZ_ESC)
  pdoc.rect(0, pH - 14, W, 14, 'F')
  pdoc.setTextColor(...BRANCO); pdoc.setFontSize(8); pdoc.setFont('helvetica', 'normal')
  pdoc.text('Rhodia Santo André — Sistema de Controle de Façonagem', W / 2, pH - 5, { align: 'center' })

  const filename = `romaneio_${saida.romaneio_microdata}_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`
  pdoc.save(filename)
}
