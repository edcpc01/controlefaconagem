import { supabase } from './supabase'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// Tipos que aplicam abatimento de 1,5%
export const TIPOS_COM_ABATIMENTO = ['faturamento', 'sucata', 'estopa']

export const TIPOS_SAIDA = [
  { value: 'faturamento', label: 'Faturamento' },
  { value: 'dev_qualidade', label: 'Devolução Qualidade' },
  { value: 'dev_processo', label: 'Devolução Processo' },
  { value: 'dev_final_campanha', label: 'Devolução Final de Campanha' },
  { value: 'sucata', label: 'Sucata' },
  { value: 'estopa', label: 'Estopa' },
]

export const PERCENTUAL_ABATIMENTO = 0.015 // 1,5%

export function calcularVolumeAbatido(volumeBruto, tipoSaida) {
  if (TIPOS_COM_ABATIMENTO.includes(tipoSaida)) {
    return volumeBruto * (1 - PERCENTUAL_ABATIMENTO)
  }
  return volumeBruto
}

// ──────────────────────────────────────────────────────────
// NF ENTRADA
// ──────────────────────────────────────────────────────────

export async function listarNFsEntrada() {
  const { data, error } = await supabase
    .from('nf_entrada')
    .select('*')
    .order('data_emissao', { ascending: true })
  if (error) throw error
  return data
}

export async function criarNFEntrada(payload) {
  const { data, error } = await supabase
    .from('nf_entrada')
    .insert({ ...payload, volume_saldo_kg: payload.volume_kg })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deletarNFEntrada(id) {
  const { error } = await supabase.from('nf_entrada').delete().eq('id', id)
  if (error) throw error
}

// ──────────────────────────────────────────────────────────
// SAÍDA COM ALOCAÇÃO FIFO
// ──────────────────────────────────────────────────────────

export async function criarSaida(payload) {
  const { romaneio_microdata, codigo_produto, lote_produto, tipo_saida, volume_bruto_kg } = payload

  const temAbatimento = TIPOS_COM_ABATIMENTO.includes(tipo_saida)
  const volume_abatido_kg = calcularVolumeAbatido(volume_bruto_kg, tipo_saida)
  const percentual_abatimento = temAbatimento ? PERCENTUAL_ABATIMENTO : 0

  // Buscar NFs com saldo disponível, ordenadas por data_emissao (FIFO)
  const { data: nfsComSaldo, error: errNFs } = await supabase
    .from('nf_entrada')
    .select('*')
    .gt('volume_saldo_kg', 0)
    .order('data_emissao', { ascending: true })

  if (errNFs) throw errNFs

  // Calcular alocações FIFO
  let volumeRestante = volume_abatido_kg
  const alocacoes = []

  for (const nf of nfsComSaldo) {
    if (volumeRestante <= 0) break

    const alocar = Math.min(nf.volume_saldo_kg, volumeRestante)
    alocacoes.push({
      nf_entrada_id: nf.id,
      numero_nf: nf.numero_nf,
      data_emissao: nf.data_emissao,
      volume_alocado_kg: alocar,
    })
    volumeRestante -= alocar
  }

  if (volumeRestante > 0.01) {
    throw new Error(`Saldo insuficiente nas NFs de entrada. Faltam ${volumeRestante.toFixed(4)} kg.`)
  }

  // Inserir saída
  const { data: saida, error: errSaida } = await supabase
    .from('saida')
    .insert({
      romaneio_microdata,
      codigo_produto,
      lote_produto,
      tipo_saida,
      volume_bruto_kg,
      volume_abatido_kg,
      percentual_abatimento,
    })
    .select()
    .single()

  if (errSaida) throw errSaida

  // Inserir alocações e atualizar saldos das NFs
  const alocacoesComSaidaId = alocacoes.map(a => ({ ...a, saida_id: saida.id }))
  const { error: errAloc } = await supabase.from('alocacao_saida').insert(alocacoesComSaidaId)
  if (errAloc) throw errAloc

  // Atualizar saldo das NFs (decrementar usando o saldo já calculado do loop FIFO)
  for (let i = 0; i < alocacoes.length; i++) {
    const aloc = alocacoes[i]
    const nfOriginal = nfsComSaldo.find(n => n.id === aloc.nf_entrada_id)
    const novoSaldo = Number(nfOriginal.volume_saldo_kg) - aloc.volume_alocado_kg
    const { error: errUpd } = await supabase
      .from('nf_entrada')
      .update({ volume_saldo_kg: novoSaldo })
      .eq('id', aloc.nf_entrada_id)
    if (errUpd) throw errUpd
  }

  return { saida, alocacoes }
}

export async function listarSaidas() {
  const { data, error } = await supabase
    .from('saida')
    .select('*, alocacao_saida(*)')
    .order('criado_em', { ascending: false })
  if (error) throw error
  return data
}

export async function buscarSaidaComAlocacoes(saidaId) {
  const { data, error } = await supabase
    .from('saida')
    .select('*, alocacao_saida(*)')
    .eq('id', saidaId)
    .single()
  if (error) throw error
  return data
}

// ──────────────────────────────────────────────────────────
// GERAÇÃO DE ROMANEIO PDF
// ──────────────────────────────────────────────────────────

export function gerarRomaneioPDF(saida, alocacoes) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const azulEscuro = [15, 40, 80]
  const azulMedio = [26, 80, 150]
  const azulClaro = [220, 235, 255]
  const branco = [255, 255, 255]

  // Cabeçalho
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

  // Linha divisória
  doc.setDrawColor(...azulMedio)
  doc.setLineWidth(0.5)
  doc.line(14, 40, W - 14, 40)

  // Dados da saída
  let y = 48
  const tipoLabel = TIPOS_SAIDA.find(t => t.value === saida.tipo_saida)?.label || saida.tipo_saida
  const temAbatimento = TIPOS_COM_ABATIMENTO.includes(saida.tipo_saida)

  doc.setFillColor(...azulClaro)
  doc.roundedRect(14, y - 5, W - 28, 52, 3, 3, 'F')

  doc.setTextColor(...azulEscuro)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')

  const campos = [
    ['Romaneio Microdata', saida.romaneio_microdata],
    ['Código do Produto', saida.codigo_produto],
    ['Lote do Produto', saida.lote_produto],
    ['Tipo de Saída', tipoLabel],
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

  // Volumes
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
    doc.setTextColor(26, 80, 150)
    doc.text(`${Number(saida.volume_abatido_kg).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} kg`, W / 2 + 62, y)
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(80, 80, 80)
    doc.text('Volume Final:', W / 2 + 6, y)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(26, 80, 150)
    doc.text(`${Number(saida.volume_abatido_kg).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} kg`, W / 2 + 36, y)
  }

  y += 18

  // Tabela de NFs abatidas
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
      format(new Date(a.data_emissao), 'dd/MM/yyyy'),
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
    headStyles: { fillColor: azulMedio, textColor: branco, fontStyle: 'bold', fontSize: 10 },
    bodyStyles: { textColor: [30, 30, 60], fontSize: 9 },
    footStyles: { fillColor: azulClaro, textColor: azulEscuro, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [240, 246, 255] },
    columnStyles: { 2: { halign: 'right' } },
  })

  // Rodapé
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
