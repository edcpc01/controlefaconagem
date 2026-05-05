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

// Coleções padrão (Rhodia) — usado como fallback
export const COLECOES_PADRAO = {
  nf_entrada:     'nf_entrada',
  saida:          'saida',
  alocacao_saida: 'alocacao_saida',
  log_acoes:      'log_acoes',
  inventario:     'inventario',
  nf_historico:   'nf_historico',
  config:         'config',
  codigo_sankhia: 'codigo_sankhia',
}

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
  { value: 'insumo',             label: 'Saída de Insumo' },
]

export const PERCENTUAL_ABATIMENTO = 0.015

// Regra especial para material 135612: abatimento de 3,5% distribuído entre matérias-primas de entrada
export const MATERIAL_ESPECIAL_135612 = {
  codigo: '135612',
  percentual_abatimento: 0.035,
  distribuicao: [
    { codigo_material: '142450', percentual: 0.60 },
    { codigo_material: '140019', percentual: 0.30 },
    { codigo_material: '98673',  percentual: 0.10 },
  ],
}

// Regra Nilit: o abatimento (% configurado) é debitado das NFs do material 23033 (STANTEX® UNF)
// como "Óleo de Encimagem". Aplica-se a saídas POY (matérias-primas) com abatimento,
// exceto quando o próprio material da saída é o 23033 ou um insumo.
export const MATERIAL_OLEO_ENCIMAGEM_NILIT = {
  codigo: '23033',
  descricao: 'STANTEX® UNF',
}

export function isOleoEncimagemNilitAplicavel(colecoes, codigoMaterial, tipoMaterial) {
  if (colecoes?.nf_entrada !== 'nf_entrada_nilit') return false
  if (codigoMaterial === MATERIAL_OLEO_ENCIMAGEM_NILIT.codigo) return false
  if (tipoMaterial === 'insumo') return false
  return true
}

// percentualBase: valor configurado pelo admin (ex: 0.015). Se omitido, usa PERCENTUAL_ABATIMENTO.
export function getPercentualAbatimento(codigoMaterial, percentualBase) {
  if (codigoMaterial === MATERIAL_ESPECIAL_135612.codigo) return MATERIAL_ESPECIAL_135612.percentual_abatimento
  return percentualBase != null ? percentualBase : PERCENTUAL_ABATIMENTO
}

export function calcularVolumeAbatido(volumeLiquido, tipoSaida, codigoMaterial = '', percentualBase) {
  if (!TIPOS_COM_ABATIMENTO.includes(tipoSaida)) return volumeLiquido
  return volumeLiquido * (1 - getPercentualAbatimento(codigoMaterial, percentualBase))
}

// ─────────────────────────────────────────────────────────────────
// VENCIMENTO DE NFs
// ─────────────────────────────────────────────────────────────────

// Retorna status de vencimento de uma NF com saldo > 0
// 'ok'       → menos de 5 meses
// 'alerta'   → entre 5 e 6 meses (aviso: vence em breve)
// 'vencida'  → mais de 6 meses com saldo
// 'zerada'   → saldo <= 0 (não exibe alerta)
export function statusVencimentoNF(nf) {
  const saldo = Number(nf.volume_saldo_kg || 0)
  if (saldo <= 0.01) return 'zerada'
  if (!nf.data_emissao) return 'ok'
  const emissao = new Date(nf.data_emissao)
  if (isNaN(emissao)) return 'ok'
  const diasDecorridos = (Date.now() - emissao.getTime()) / (1000 * 60 * 60 * 24)
  if (diasDecorridos > 180) return 'vencida'   // > 6 meses
  if (diasDecorridos > 150) return 'alerta'    // entre 5 e 6 meses
  return 'ok'
}

// Dias restantes até 6 meses (negativo = já vencido)
export function diasParaVencimento(nf) {
  if (!nf.data_emissao) return 999
  const emissao = new Date(nf.data_emissao)
  if (isNaN(emissao)) return 999
  const vencimento = new Date(emissao.getTime() + 180 * 24 * 60 * 60 * 1000)
  return Math.ceil((vencimento.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
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

export async function registrarLog(acao, descricao, usuario, colecoes = COLECOES_PADRAO) {
  try {
    await addDoc(collection(db, colecoes.log_acoes), {
      acao, descricao,
      usuario_email: usuario?.email || 'desconhecido',
      usuario_nome:  usuario?.displayName || usuario?.email || 'desconhecido',
      criado_em:     Timestamp.now(),
    })
  } catch (_) {}
}

export async function listarLogs(colecoes = COLECOES_PADRAO) {
  const snap = await getDocs(query(collection(db, colecoes.log_acoes), orderBy('criado_em', 'desc')))
  return snap.docs.map(d => ({ id: d.id, ...d.data(), criado_em: tsToDateTime(d.data().criado_em) }))
}

// ─────────────────────────────────────────────────────────────────
// CONFIGURAÇÕES
// ─────────────────────────────────────────────────────────────────

export async function salvarConfig(payload, colecoes = COLECOES_PADRAO) {
  await setDoc(doc(db, colecoes.config, 'app'), payload, { merge: true })
}

export async function carregarConfig(colecoes = COLECOES_PADRAO) {
  const snap = await getDoc(doc(db, colecoes.config, 'app'))
  return snap.exists() ? snap.data() : {}
}

// ─────────────────────────────────────────────────────────────────
// CÓDIGOS SANKHIA — mapeamento código_material → código_sankhia
// ─────────────────────────────────────────────────────────────────

// Limpa "SK" prefixo do COMPLDESC (ex.: "SK21986" → "21986")
export function normalizarCodigoNFFromSankhia(compldesc) {
  if (compldesc == null) return ''
  return String(compldesc).trim().replace(/^SK\s*/i, '')
}

export async function listarCodigosSankhia(colecoes = COLECOES_PADRAO) {
  const snap = await getDocs(collection(db, colecoes.codigo_sankhia))
  return snap.docs.map(d => ({
    id: d.id, ...d.data(),
    atualizado_em: tsToDateTime(d.data().atualizado_em),
  }))
}

// Carrega como Map<codigo_material, { codigo_sankhia, descricao_sankhia, id }> para lookup rápido
export async function carregarMapaSankhia(colecoes = COLECOES_PADRAO) {
  const lista = await listarCodigosSankhia(colecoes)
  const map = new Map()
  for (const item of lista) {
    if (item.codigo_material) map.set(String(item.codigo_material), item)
  }
  return map
}

// Upsert por codigo_material (uma entrada por material)
export async function salvarCodigoSankhia(payload, usuario, colecoes = COLECOES_PADRAO) {
  const codigoMaterial = String(payload.codigo_material || '').trim()
  if (!codigoMaterial) throw new Error('Informe o código do material.')
  const codigoSankhia = String(payload.codigo_sankhia || '').trim()
  if (!codigoSankhia) throw new Error('Informe o código Sankhia.')

  const now = Timestamp.now()
  // Procura existente
  const existente = await getDocs(query(collection(db, colecoes.codigo_sankhia), where('codigo_material', '==', codigoMaterial)))
  const data = {
    codigo_material:    codigoMaterial,
    codigo_sankhia:     codigoSankhia,
    descricao_sankhia:  payload.descricao_sankhia || '',
    atualizado_em:      now,
  }
  if (!existente.empty) {
    const ref = doc(db, colecoes.codigo_sankhia, existente.docs[0].id)
    await setDoc(ref, data, { merge: true })
    await registrarLog('SANKHIA_ATUALIZADO', `${codigoMaterial} → ${codigoSankhia}`, usuario, colecoes)
    return { id: existente.docs[0].id, ...data }
  } else {
    const ref = await addDoc(collection(db, colecoes.codigo_sankhia), { ...data, criado_em: now })
    await registrarLog('SANKHIA_CRIADO', `${codigoMaterial} → ${codigoSankhia}`, usuario, colecoes)
    return { id: ref.id, ...data }
  }
}

export async function deletarCodigoSankhia(id, usuario, colecoes = COLECOES_PADRAO) {
  const snap = await getDoc(doc(db, colecoes.codigo_sankhia, id))
  if (!snap.exists()) throw new Error('Mapeamento não encontrado.')
  const data = snap.data()
  await deleteDoc(doc(db, colecoes.codigo_sankhia, id))
  await registrarLog('SANKHIA_EXCLUIDO', `${data.codigo_material} → ${data.codigo_sankhia}`, usuario, colecoes)
}

// Importação em lote a partir de linhas { CODPROD, COMPLDESC, DESCRPROD? }
// Retorna { criados, atualizados, ignorados, erros }
export async function importarCodigosSankhiaXLSX(linhas, usuario, colecoes = COLECOES_PADRAO) {
  let criados = 0, atualizados = 0, ignorados = 0
  const erros = []
  // Carrega existentes uma vez para detectar criação vs atualização
  const existentesSnap = await getDocs(collection(db, colecoes.codigo_sankhia))
  const existentesMap = new Map() // codigo_material → docId
  existentesSnap.docs.forEach(d => existentesMap.set(String(d.data().codigo_material), d.id))

  const now = Timestamp.now()
  const batch = writeBatch(db)
  let ops = 0

  for (const linha of linhas) {
    const codSankhia = String(linha.CODPROD ?? linha.codprod ?? '').trim()
    const compldesc  = String(linha.COMPLDESC ?? linha.compldesc ?? '').trim()
    const codNF      = normalizarCodigoNFFromSankhia(compldesc)
    const descricao  = String(linha.DESCRPROD ?? linha.descrprod ?? '').trim()
    if (!codSankhia || !codNF) { ignorados++; continue }

    const data = {
      codigo_material:   codNF,
      codigo_sankhia:    codSankhia,
      descricao_sankhia: descricao,
      atualizado_em:     now,
    }

    const docId = existentesMap.get(codNF)
    if (docId) {
      batch.set(doc(db, colecoes.codigo_sankhia, docId), data, { merge: true })
      atualizados++
    } else {
      const newRef = doc(collection(db, colecoes.codigo_sankhia))
      batch.set(newRef, { ...data, criado_em: now })
      existentesMap.set(codNF, newRef.id) // evita duplicar se a planilha repetir o COMPLDESC
      criados++
    }

    ops++
    // Firestore limita 500 ops por batch — commita e abre nova
    if (ops >= 450) {
      try { await batch.commit() } catch (e) { erros.push(e.message) }
      ops = 0
    }
  }
  if (ops > 0) {
    try { await batch.commit() } catch (e) { erros.push(e.message) }
  }

  await registrarLog('SANKHIA_IMPORT', `XLSX: ${criados} criados, ${atualizados} atualizados, ${ignorados} ignorados`, usuario, colecoes)
  return { criados, atualizados, ignorados, erros }
}

// ─────────────────────────────────────────────────────────────────
// NF ENTRADA — CRUD + EDIÇÃO
// ─────────────────────────────────────────────────────────────────

export async function listarNFsEntrada(unidadeId = '', colecoes = COLECOES_PADRAO) {
  const snap = await getDocs(query(collection(db, colecoes.nf_entrada), orderBy('data_emissao', 'asc')))
  const todos = snap.docs.map(docToObj)
  // Filtra por unidade se informada; docs sem unidade_id pertencem à raiz (sem unidade)
  if (!unidadeId) return todos
  return todos.filter(nf => (nf.unidade_id || '') === unidadeId)
}

export async function criarNFEntrada(payload, usuario, colecoes = COLECOES_PADRAO) {
  const now = Timestamp.now()
  const docRef = await addDoc(collection(db, colecoes.nf_entrada), {
    numero_nf:       payload.numero_nf,
    data_emissao:    Timestamp.fromDate(new Date(payload.data_emissao + 'T12:00:00')),
    codigo_material: payload.codigo_material,
    descricao_material: payload.descricao_material || '',
    lote:            payload.lote,
    volume_kg:       payload.volume_kg,
    volume_saldo_kg: payload.volume_kg,
    valor_unitario:  payload.valor_unitario,
    tipo_material:   payload.tipo_material || 'materia_prima',
    unidade_id:      payload.unidade_id || '',
    criado_em:       now,
    atualizado_em:   now,
  })
  await registrarLog('NF_ENTRADA_CRIADA', `NF ${payload.numero_nf} — ${payload.volume_kg} kg`, usuario, colecoes)
  const snap = await getDoc(docRef)
  return docToObj(snap)
}

export async function editarNFEntrada(id, payload, usuario, colecoes = COLECOES_PADRAO) {
  const now = Timestamp.now()
  const snapAtual = await getDoc(doc(db, colecoes.nf_entrada, id))
  if (!snapAtual.exists()) throw new Error('NF não encontrada.')
  const atual = snapAtual.data()
  const consumido = Number(atual.volume_kg) - Number(atual.volume_saldo_kg)
  const novoSaldo = Math.max(0, payload.volume_kg - consumido)

  const dadosAntes = {
    numero_nf: atual.numero_nf, data_emissao: tsToISO(atual.data_emissao),
    codigo_material: atual.codigo_material, descricao_material: atual.descricao_material || '', lote: atual.lote,
    volume_kg: atual.volume_kg, valor_unitario: atual.valor_unitario,
  }
  const dadosDepois = {
    numero_nf: payload.numero_nf, data_emissao: payload.data_emissao,
    codigo_material: payload.codigo_material, descricao_material: payload.descricao_material || '', lote: payload.lote,
    volume_kg: payload.volume_kg, valor_unitario: payload.valor_unitario,
  }

  await updateDoc(doc(db, colecoes.nf_entrada, id), {
    numero_nf:       payload.numero_nf,
    data_emissao:    Timestamp.fromDate(new Date(payload.data_emissao + 'T12:00:00')),
    codigo_material: payload.codigo_material,
    descricao_material: payload.descricao_material || '',
    lote:            payload.lote,
    volume_kg:       payload.volume_kg,
    volume_saldo_kg: novoSaldo,
    valor_unitario:  payload.valor_unitario,
    tipo_material:   payload.tipo_material || 'materia_prima',
    unidade_id:      payload.unidade_id || '',
    atualizado_em:   now,
  })

  // Registra histórico de edição
  await addDoc(collection(db, colecoes.nf_historico), {
    nf_id: id,
    dados_antes: dadosAntes,
    dados_depois: dadosDepois,
    usuario_email: usuario?.email || '',
    editado_em: now,
  })
  await registrarLog('NF_ENTRADA_EDITADA', `NF ${payload.numero_nf} atualizada`, usuario, colecoes)
}

export async function deletarNFEntrada(id, numeroNF, usuario, colecoes = COLECOES_PADRAO) {
  await deleteDoc(doc(db, colecoes.nf_entrada, id))
  await registrarLog('NF_ENTRADA_REMOVIDA', `NF ${numeroNF} removida`, usuario, colecoes)
}

export async function buscarAlocacoesPorNF(nfId, colecoes = COLECOES_PADRAO) {
  // Sem orderBy para evitar necessidade de índice composto no Firestore
  const alocSnap = await getDocs(
    query(collection(db, colecoes.alocacao_saida), where('nf_entrada_id', '==', nfId))
  )
  if (alocSnap.empty) return []
  const saidaIds = [...new Set(alocSnap.docs.map(d => d.data().saida_id))]
  const saidasMap = {}
  await Promise.all(saidaIds.map(async (sid) => {
    const sSnap = await getDoc(doc(db, colecoes.saida, sid))
    if (sSnap.exists()) {
      const d = sSnap.data()
      saidasMap[sid] = { id: sSnap.id, ...d, criado_em: tsToDateTime(d.criado_em) }
    }
  }))
  // Ordenar por criado_em em memória
  const results = alocSnap.docs.map(d => {
    const aloc = d.data()
    return { id: d.id, ...aloc, criado_em: tsToDateTime(aloc.criado_em), saida: saidasMap[aloc.saida_id] || null }
  })
  return results.sort((a, b) => (a.criado_em || '').localeCompare(b.criado_em || ''))
}

// ─────────────────────────────────────────────────────────────────
// EXTRAÇÃO DE DADOS DA NF PDF (via Claude API)
// ─────────────────────────────────────────────────────────────────

// Extrai texto e (se digitalizado) imagem do PDF via pdfjs-dist (roda no browser)
async function extrairTextoPDF(base64Data) {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

  const raw   = atob(base64Data)
  const uint8 = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) uint8[i] = raw.charCodeAt(i)

  const pdf   = await pdfjsLib.getDocument({ data: uint8 }).promise
  let   texto = ''
  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p)
    const content = await page.getTextContent()
    texto += content.items.map(i => i.str).join(' ') + '\n'
  }

  // Se texto insuficiente (PDF digitalizado/imagem), renderiza página 1 como JPEG
  let imageBase64 = null
  if (texto.trim().length < 80) {
    try {
      const page     = await pdf.getPage(1)
      const viewport = page.getViewport({ scale: 2.0 })
      const canvas   = document.createElement('canvas')
      canvas.width   = viewport.width
      canvas.height  = viewport.height
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      imageBase64 = canvas.toDataURL('image/jpeg', 0.88).split(',')[1]
    } catch (_) {}
  }

  return { texto, imageBase64 }
}

// Envia texto (ou imagem) ao proxy Vercel → OpenRouter → retorna { numero_nf, data_emissao, itens }
export async function extrairDadosNFdoPDF(base64Data, operacaoAtiva) {
  const { texto: pdfText, imageBase64 } = await extrairTextoPDF(base64Data)

  const response = await fetch('/api/extract-nf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdfText, imageBase64, operacao: operacaoAtiva })
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error || `Erro ${response.status} ao extrair NF.`)
  }
  const dados = await response.json()

  // Garante formato novo com itens
  if (!dados.itens) {
    dados.itens = [{
      codigo_material: dados.codigo_material || '',
      descricao_material: dados.descricao_material || dados.descricao || '',
      lote: dados.lote ? String(dados.lote).replace(/\D/g,'').substring(0,5) : '',
      volume_kg: dados.volume_kg || 0,
      valor_unitario: dados.valor_unitario || 0,
    }]
  }
  dados.itens = dados.itens.map(item => ({
    ...item,
    descricao_material: item.descricao_material || item.descricao || '',
    lote: item.lote ? String(item.lote).replace(/\D/g,'').substring(0,5) : '',
  }))

  return dados
}

// Cria múltiplas NFs de uma vez (NF com vários itens)
export async function criarNFsEntradaLote(itens, usuario, colecoes = COLECOES_PADRAO) {
  // itens: [{ numero_nf, data_emissao, codigo_material, lote, volume_kg, valor_unitario, unidade_id }]
  const resultados = []
  for (const item of itens) {
    const res = await criarNFEntrada(item, usuario, colecoes)
    resultados.push(res)
  }
  return resultados
}

// ─────────────────────────────────────────────────────────────────
// PREVIEW FIFO (sem gravar — usado para confirmação)
// ─────────────────────────────────────────────────────────────────

export async function previewFIFO(volumeAbatido, { codigoMaterial, lotePoy, unidadeId = '', volumeLiquido = null, volumeAbatimentoOverride = null, percentualBase = null, loteDigitos = 4, tipoSaida = null, colecoes = COLECOES_PADRAO } = {}) {
  const snap = await getDocs(query(collection(db, colecoes.nf_entrada), orderBy('data_emissao', 'asc')))
  const allNFs = snap.docs.map(docToObj)

  const filtrarNFs = (codMat, lote) => allNFs.filter(nf => {
    if (Number(nf.volume_saldo_kg) <= 0.001) return false
    if (unidadeId && (nf.unidade_id || '') !== unidadeId) return false
    if (codMat && nf.codigo_material !== codMat) return false
    if (lote) {
      const loteNF    = String(nf.lote || '').substring(0, loteDigitos)
      const loteSaida = String(lote).substring(0, loteDigitos)
      if (loteNF !== loteSaida) return false
    }
    return true
  })

  const buildPreview = (nfsComSaldo, volume) => {
    let restante = volume
    const preview = []
    for (const nf of nfsComSaldo) {
      if (restante <= 0) break
      const alocar = Math.min(Number(nf.volume_saldo_kg), restante)
      preview.push({ numero_nf: nf.numero_nf, data_emissao: nf.data_emissao, saldo_atual: nf.volume_saldo_kg, volume_alocado_kg: alocar })
      restante -= alocar
    }
    return { preview, saldoInsuficiente: restante > 0.01, faltando: restante }
  }

  const resultado = buildPreview(filtrarNFs(codigoMaterial, lotePoy), volumeAbatido)

  // Regra especial 135612: o abatimento (3,5% do volume líquido) é debitado de NFs de materiais companion
  // Apenas para operação Rhodia
  if (codigoMaterial === MATERIAL_ESPECIAL_135612.codigo && colecoes.nf_entrada === 'nf_entrada') {
    const volLiq = volumeLiquido != null ? volumeLiquido : volumeAbatido / (1 - MATERIAL_ESPECIAL_135612.percentual_abatimento)
    // Permite override manual do valor total do abatimento
    const volumeAbatimento = volumeAbatimentoOverride != null
      ? volumeAbatimentoOverride
      : volLiq * MATERIAL_ESPECIAL_135612.percentual_abatimento
    resultado.previewsCompanion = MATERIAL_ESPECIAL_135612.distribuicao.map(dist => {
      const volDist = volumeAbatimento * dist.percentual
      const { preview, saldoInsuficiente, faltando } = buildPreview(filtrarNFs(dist.codigo_material, null), volDist)
      return { ...dist, volume: volDist, volumeAbatimentoTotal: volumeAbatimento, preview, saldoInsuficiente, faltando }
    })
  }

  // Regra Nilit: óleo de encimagem (23033) — abatimento debitado das NFs do 23033 FIFO
  if (TIPOS_COM_ABATIMENTO.includes(tipoSaida) && volumeLiquido != null && volumeLiquido > 0) {
    const tipoMatPrincipal = (allNFs.find(nf => nf.codigo_material === codigoMaterial)?.tipo_material) || 'materia_prima'
    if (isOleoEncimagemNilitAplicavel(colecoes, codigoMaterial, tipoMatPrincipal)) {
      const pct = percentualBase != null ? percentualBase : PERCENTUAL_ABATIMENTO
      const volOleo = volumeLiquido * pct
      const nfsOleo = filtrarNFs(MATERIAL_OLEO_ENCIMAGEM_NILIT.codigo, null)
      const { preview, saldoInsuficiente, faltando } = buildPreview(nfsOleo, volOleo)
      resultado.previewOleoEncimagem = {
        codigo_material: MATERIAL_OLEO_ENCIMAGEM_NILIT.codigo,
        descricao:       MATERIAL_OLEO_ENCIMAGEM_NILIT.descricao,
        percentual:      pct,
        volume:          volOleo,
        preview,
        saldoInsuficiente,
        faltando,
      }
    }
  }

  return resultado
}

// ─────────────────────────────────────────────────────────────────
// SAÍDA COM ALOCAÇÃO FIFO
// ─────────────────────────────────────────────────────────────────

export async function criarSaida(payload, usuario, colecoes = COLECOES_PADRAO) {
  const {
    romaneio_microdata, codigo_material, lote_poy, lote_acabado,
    tipo_saida, volume_liquido_kg, volume_bruto_kg, quantidade,
    unidade_id = '',
    volume_abatimento_override = null,
    percentual_base = null,  // % configurado pelo admin via Config (ex: 0.015)
  } = payload

  const temAbatimento         = TIPOS_COM_ABATIMENTO.includes(tipo_saida)
  const isRhodia              = colecoes.nf_entrada === 'nf_entrada'
  const isEspecial135612      = isRhodia && codigo_material === MATERIAL_ESPECIAL_135612.codigo
  const volume_abatido_kg     = calcularVolumeAbatido(volume_liquido_kg, tipo_saida, isRhodia ? codigo_material : '', percentual_base)
  const percentual_abatimento = temAbatimento ? getPercentualAbatimento(codigo_material, percentual_base) : 0
  // volume_abatimento_kg: o valor que será distribuído entre os materiais companion
  const volume_abatimento_kg  = temAbatimento && isEspecial135612
    ? (volume_abatimento_override != null
        ? Number(volume_abatimento_override)
        : volume_liquido_kg * MATERIAL_ESPECIAL_135612.percentual_abatimento)
    : 0

  const snap = await getDocs(query(collection(db, colecoes.nf_entrada), orderBy('data_emissao', 'asc')))
  const nfsComSaldo = snap.docs.map(docToObj).filter(nf => {
    if (Number(nf.volume_saldo_kg) <= 0.001) return false
    if (unidade_id && (nf.unidade_id || '') !== unidade_id) return false
    if (codigo_material && nf.codigo_material !== codigo_material) return false
    if (lote_poy) {
      const loteNF    = String(nf.lote || '').substring(0, 4)
      const loteSaida = String(lote_poy).substring(0, 4)
      if (loteNF !== loteSaida) return false
    }
    return true
  })

  let volumeRestante = volume_abatido_kg
  const alocacoes = []
  for (const nf of nfsComSaldo) {
    if (volumeRestante <= 0) break
    const alocar = Math.min(Number(nf.volume_saldo_kg), volumeRestante)
    alocacoes.push({ nf_entrada_id: nf.id, numero_nf: nf.numero_nf, data_emissao: nf.data_emissao, volume_alocado_kg: alocar })
    volumeRestante -= alocar
  }

  if (volumeRestante > 0.01) {
    const saldoDisp = nfsComSaldo.reduce((a, n) => a + Number(n.volume_saldo_kg), 0)
    if (saldoDisp <= 0) {
      throw new Error(`Não há NFs com saldo para o material "${codigo_material}" / lote "${lote_poy}" nesta unidade.`)
    }
    throw new Error(`Saldo insuficiente. Disponível: ${saldoDisp.toFixed(4)} kg — Solicitado: ${volume_abatido_kg.toFixed(4)} kg.`)
  }

  // ── Regra Nilit: óleo de encimagem 23033 — abatimento debitado das NFs do 23033 ──
  const tipoMatPrincipal       = nfsComSaldo[0]?.tipo_material || 'materia_prima'
  const aplicaOleoEncimagemNilit = temAbatimento && isOleoEncimagemNilitAplicavel(colecoes, codigo_material, tipoMatPrincipal)
  const percentual_oleo_nilit  = aplicaOleoEncimagemNilit ? (percentual_base != null ? percentual_base : PERCENTUAL_ABATIMENTO) : 0
  const volume_oleo_encimagem_kg = aplicaOleoEncimagemNilit ? volume_liquido_kg * percentual_oleo_nilit : 0

  // ── Regra especial 135612: alocar o abatimento (3,5%) nos materiais companion ──
  // nfsCompanionDebits: nf_entrada_id → { saldo_original, totalDebit }
  const nfsCompanionDebits = {}
  const alocacoesCompanion = []

  if (isEspecial135612 && volume_abatimento_kg > 0) {
    const snapComp = await getDocs(query(collection(db, colecoes.nf_entrada), orderBy('data_emissao', 'asc')))
    const todasNFsComp = snapComp.docs.map(docToObj)

    for (const dist of MATERIAL_ESPECIAL_135612.distribuicao) {
      const volDist = volume_abatimento_kg * dist.percentual
      const nfsComp = todasNFsComp.filter(nf => {
        if (Number(nf.volume_saldo_kg) <= 0.001) return false
        if (unidade_id && (nf.unidade_id || '') !== unidade_id) return false
        return nf.codigo_material === dist.codigo_material
      })
      let restComp = volDist
      for (const nf of nfsComp) {
        if (restComp <= 0) break
        const alocar = Math.min(Number(nf.volume_saldo_kg), restComp)
        alocacoesCompanion.push({
          nf_entrada_id: nf.id, numero_nf: nf.numero_nf, data_emissao: nf.data_emissao,
          volume_alocado_kg: alocar, codigo_material: dist.codigo_material,
        })
        if (!nfsCompanionDebits[nf.id]) nfsCompanionDebits[nf.id] = { saldo_original: Number(nf.volume_saldo_kg), totalDebit: 0 }
        nfsCompanionDebits[nf.id].totalDebit += alocar
        restComp -= alocar
      }
      if (restComp > 0.01) {
        const saldoDisp = nfsComp.reduce((a, n) => a + Number(n.volume_saldo_kg), 0)
        throw new Error(`Saldo insuficiente no material ${dist.codigo_material}. Disponível: ${saldoDisp.toFixed(4)} kg — Necessário: ${volDist.toFixed(4)} kg.`)
      }
    }
  }

  // ── Regra Nilit: alocar óleo de encimagem nas NFs do 23033 (FIFO) ──
  if (aplicaOleoEncimagemNilit && volume_oleo_encimagem_kg > 0) {
    const snapOleo  = await getDocs(query(collection(db, colecoes.nf_entrada), orderBy('data_emissao', 'asc')))
    const nfsOleo   = snapOleo.docs.map(docToObj).filter(nf => {
      if (Number(nf.volume_saldo_kg) <= 0.001) return false
      if (unidade_id && (nf.unidade_id || '') !== unidade_id) return false
      return nf.codigo_material === MATERIAL_OLEO_ENCIMAGEM_NILIT.codigo
    })
    let restOleo = volume_oleo_encimagem_kg
    for (const nf of nfsOleo) {
      if (restOleo <= 0) break
      const alocar = Math.min(Number(nf.volume_saldo_kg), restOleo)
      alocacoesCompanion.push({
        nf_entrada_id: nf.id, numero_nf: nf.numero_nf, data_emissao: nf.data_emissao,
        volume_alocado_kg: alocar, codigo_material: MATERIAL_OLEO_ENCIMAGEM_NILIT.codigo,
      })
      if (!nfsCompanionDebits[nf.id]) nfsCompanionDebits[nf.id] = { saldo_original: Number(nf.volume_saldo_kg), totalDebit: 0 }
      nfsCompanionDebits[nf.id].totalDebit += alocar
      restOleo -= alocar
    }
    if (restOleo > 0.01) {
      const saldoDisp = nfsOleo.reduce((a, n) => a + Number(n.volume_saldo_kg), 0)
      throw new Error(`Saldo insuficiente do óleo de encimagem (${MATERIAL_OLEO_ENCIMAGEM_NILIT.codigo} ${MATERIAL_OLEO_ENCIMAGEM_NILIT.descricao}). Disponível: ${saldoDisp.toFixed(4)} kg — Necessário: ${volume_oleo_encimagem_kg.toFixed(4)} kg.`)
    }
  }

  const now      = Timestamp.now()
  const batch    = writeBatch(db)
  const saidaRef = doc(collection(db, colecoes.saida))

  const tipo_companion = isEspecial135612 && volume_abatimento_kg > 0
    ? 'rhodia_135612'
    : (aplicaOleoEncimagemNilit && volume_oleo_encimagem_kg > 0 ? 'oleo_encimagem_nilit' : null)
  const volume_companion_kg = tipo_companion === 'rhodia_135612'
    ? volume_abatimento_kg
    : (tipo_companion === 'oleo_encimagem_nilit' ? volume_oleo_encimagem_kg : 0)

  batch.set(saidaRef, {
    romaneio_microdata,
    codigo_material,
    codigo_produto: codigo_material,
    lote_poy,
    lote_acabado:   lote_acabado || '',
    tipo_saida,
    volume_liquido_kg,
    volume_bruto_kg:  volume_bruto_kg || null,
    quantidade:       quantidade || null,
    volume_abatido_kg,
    percentual_abatimento,
    volume_abatimento_kg: volume_companion_kg || null,   // 135612 (Rhodia) ou óleo encimagem (Nilit)
    tipo_companion,                                       // 'rhodia_135612' | 'oleo_encimagem_nilit' | null
    unidade_id,
    usuario_email: usuario?.email || '',
    criado_em: now,
  })

  // Alocações principais (material 135612 → suas próprias NFs)
  const alocacoesRetorno = []
  for (const aloc of alocacoes) {
    const alocRef  = doc(collection(db, colecoes.alocacao_saida))
    const alocData = {
      saida_id: saidaRef.id, nf_entrada_id: aloc.nf_entrada_id,
      numero_nf: aloc.numero_nf, data_emissao: aloc.data_emissao,
      volume_alocado_kg: aloc.volume_alocado_kg, criado_em: now,
    }
    batch.set(alocRef, alocData)
    alocacoesRetorno.push({ id: alocRef.id, ...alocData })
  }
  for (const aloc of alocacoes) {
    const nfOrig    = nfsComSaldo.find(n => n.id === aloc.nf_entrada_id)
    const novoSaldo = Number(nfOrig.volume_saldo_kg) - aloc.volume_alocado_kg
    batch.update(doc(db, colecoes.nf_entrada, aloc.nf_entrada_id), { volume_saldo_kg: Math.max(0, novoSaldo), atualizado_em: now })
  }

  // Alocações companion (abatimento 3,5% distribuído por material)
  const alocacoesCompanionRetorno = []
  for (const aloc of alocacoesCompanion) {
    const alocRef  = doc(collection(db, colecoes.alocacao_saida))
    const alocData = {
      saida_id: saidaRef.id, nf_entrada_id: aloc.nf_entrada_id,
      numero_nf: aloc.numero_nf, data_emissao: aloc.data_emissao,
      volume_alocado_kg: aloc.volume_alocado_kg,
      codigo_material_companion: aloc.codigo_material,
      criado_em: now,
    }
    batch.set(alocRef, alocData)
    alocacoesCompanionRetorno.push({ id: alocRef.id, ...alocData })
  }
  // Uma única update por NF companion (evita conflito no batch)
  for (const [nfId, info] of Object.entries(nfsCompanionDebits)) {
    const novoSaldo = info.saldo_original - info.totalDebit
    batch.update(doc(db, colecoes.nf_entrada, nfId), { volume_saldo_kg: Math.max(0, novoSaldo), atualizado_em: now })
  }

  await batch.commit()
  await registrarLog(
    'SAIDA_REGISTRADA',
    `Romaneio ${romaneio_microdata} — ${volume_abatido_kg.toFixed(4)} kg (${TIPOS_SAIDA.find(t=>t.value===tipo_saida)?.label}) | ${codigo_material} / Lote ${lote_poy}`,
    usuario,
    colecoes
  )

  return {
    saida: {
      id: saidaRef.id, romaneio_microdata, codigo_material, lote_poy, lote_acabado,
      tipo_saida, volume_liquido_kg, volume_bruto_kg, quantidade,
      volume_abatido_kg, percentual_abatimento,
      volume_abatimento_kg: volume_companion_kg || null,
      tipo_companion,
      unidade_id,
      criado_em: now.toDate().toISOString()
    },
    alocacoes: alocacoesRetorno,
    alocacoesCompanion: alocacoesCompanionRetorno,
  }
}

export async function listarSaidas(unidadeId = '', colecoes = COLECOES_PADRAO) {
  const [saidasSnap, alocSnap] = await Promise.all([
    getDocs(query(collection(db, colecoes.saida), orderBy('criado_em', 'desc'))),
    getDocs(collection(db, colecoes.alocacao_saida)),
  ])
  const alocPorSaida = {}
  alocSnap.docs.forEach(d => {
    const data = d.data()
    if (!alocPorSaida[data.saida_id]) alocPorSaida[data.saida_id] = []
    alocPorSaida[data.saida_id].push({ id: d.id, ...data })
  })
  const todas = saidasSnap.docs.map(d => {
    const data = d.data()
    return {
      id: d.id, ...data,
      codigo_material: data.codigo_material || data.codigo_produto || '',
      criado_em: tsToDateTime(d.data().criado_em),
      alocacao_saida: alocPorSaida[d.id] || []
    }
  })
  if (!unidadeId) return todas
  return todas.filter(s => (s.unidade_id || '') === unidadeId)
}

// Exclui uma saída e estorna o saldo nas NFs de entrada
export async function deletarSaida(saidaId, usuario, colecoes = COLECOES_PADRAO) {
  // Busca alocações desta saída para estornar
  const alocSnap = await getDocs(
    query(collection(db, colecoes.alocacao_saida), where('saida_id', '==', saidaId))
  )
  const saidaSnap = await getDoc(doc(db, colecoes.saida, saidaId))
  if (!saidaSnap.exists()) throw new Error('Saída não encontrada.')
  const saida = saidaSnap.data()

  const batch = writeBatch(db)
  const now   = Timestamp.now()

  // Estorna saldo em cada NF alocada
  for (const alocDoc of alocSnap.docs) {
    const aloc   = alocDoc.data()
    const nfSnap = await getDoc(doc(db, colecoes.nf_entrada, aloc.nf_entrada_id))
    if (nfSnap.exists()) {
      const saldoAtual  = Number(nfSnap.data().volume_saldo_kg || 0)
      const novoSaldo   = saldoAtual + Number(aloc.volume_alocado_kg)
      batch.update(doc(db, colecoes.nf_entrada, aloc.nf_entrada_id), { volume_saldo_kg: novoSaldo, atualizado_em: now })
    }
    batch.delete(doc(db, colecoes.alocacao_saida, alocDoc.id))
  }

  batch.delete(doc(db, colecoes.saida, saidaId))
  await batch.commit()
  await registrarLog('SAIDA_EXCLUIDA', `Romaneio ${saida.romaneio_microdata} excluído — saldo estornado`, usuario, colecoes)
}

// Verifica se número de NF já existe em qualquer unidade
export async function verificarNFDuplicada(numeroNF, colecoes = COLECOES_PADRAO) {
  const snap = await getDocs(query(collection(db, colecoes.nf_entrada), where('numero_nf', '==', String(numeroNF).trim())))
  if (snap.empty) return null
  const nf = snap.docs[0].data()
  return { existe: true, unidade_id: nf.unidade_id || '' }
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
    'Abatimento':         TIPOS_COM_ABATIMENTO.includes(s.tipo_saida) ? `${((s.percentual_abatimento || 0.015) * 100).toFixed(1).replace('.', ',')}%` : '0%',
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
  XLSX.writeFile(wb, `faconagem_corradi_mazzer_${ts}.xlsx`)
}

// ─────────────────────────────────────────────────────────────────
// ROMANEIO PDF (com logo)
// ─────────────────────────────────────────────────────────────────

function _buildRomaneioPDF(saida, alocacoes, config = {}, alocacoesCompanion = []) {
  // Para saídas de insumo: usar layout multi-saída (mesmo formato do romaneio múltiplo)
  if (saida.tipo_saida === 'insumo') {
    return _buildMultiSaidaPDF({
      romaneio_microdata: saida.romaneio_microdata,
      tipo_saida:         saida.tipo_saida,
      lote_acabado:       saida.lote_acabado || '',
      criado_em:          saida.criado_em,
      codigo_sankhia_oleo: saida.codigo_sankhia_oleo || '',
      itens: [{
        codigo_material:    saida.codigo_material || saida.codigo_produto || '—',
        codigo_sankhia:     saida.codigo_sankhia || '',
        lote_poy:           saida.lote_poy || '',
        descricao_material: saida.descricao_material || '—',
        volume_liquido_kg:  saida.volume_liquido_kg,
        volume_abatido_kg:  saida.volume_abatido_kg,
        alocacoes,
        alocacoesCompanion,
      }],
    }, config)
  }

  const pdoc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W     = 210
  const DARK  = [15, 40, 80]
  const MED   = [26, 80, 150]
  const LIGHT = [220, 235, 255]
  const WHITE = [255, 255, 255]
  const GRAY  = [80, 80, 80]

  const tipoLbl = TIPOS_SAIDA.find(t => t.value === saida.tipo_saida)?.label || saida.tipo_saida
  const temAbat = TIPOS_COM_ABATIMENTO.includes(saida.tipo_saida)
  const fmtKg   = n => n != null ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg' : '—'
  const codigoMaterial = saida.codigo_material || saida.codigo_produto || '—'

  // ── Cabeçalho ──────────────────────────────────────────
  const headerH = 36
  pdoc.setFillColor(...DARK)
  pdoc.rect(0, 0, W, headerH, 'F')

  if (config.logoBase64) {
    try { pdoc.addImage(config.logoBase64, 'PNG', 14, 5, 26, 26) } catch (_) {}
  }

  pdoc.setTextColor(...WHITE)
  pdoc.setFontSize(16); pdoc.setFont('helvetica', 'bold')
  pdoc.text('CORRADI MAZZER — FAÇONAGEM', W / 2, 13, { align: 'center' })
  pdoc.setFontSize(10); pdoc.setFont('helvetica', 'normal')
  pdoc.text('ROMANEIO DE SAÍDA', W / 2, 21, { align: 'center' })
  pdoc.setFontSize(8)
  pdoc.text(`Emitido: ${format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`, W / 2, 29, { align: 'center' })

  let y = headerH + 8

  // ── Dados do Romaneio ──────────────────────────────────
  // Calcula altura do box dinamicamente
  const hasOpcional = !!(saida.lote_acabado || saida.quantidade)
  const boxH = 14 + 14 + 14 + (hasOpcional ? 14 : 0)
  pdoc.setFillColor(...LIGHT)
  pdoc.roundedRect(14, y, W - 28, boxH, 3, 3, 'F')

  const linha = (lbl, val, cx, cy) => {
    pdoc.setFont('helvetica', 'bold'); pdoc.setFontSize(8); pdoc.setTextColor(...GRAY)
    pdoc.text(lbl, cx, cy)
    pdoc.setFont('helvetica', 'normal'); pdoc.setTextColor(...DARK)
    pdoc.text(String(val ?? '—'), cx, cy + 5)
  }

  const col1 = 20, col2 = W / 2 + 4
  const codigoMaterialDisplay = saida.codigo_sankhia
    ? `${codigoMaterial}  (SK ${saida.codigo_sankhia})`
    : codigoMaterial
  y += 7
  linha('Romaneio Microdata',    saida.romaneio_microdata,  col1, y)
  linha('Código do Material',    codigoMaterialDisplay,     col2, y)
  y += 14
  linha('Lote POY',              saida.lote_poy || '—',     col1, y)
  linha('Tipo de Saída',         tipoLbl,                   col2, y)
  y += 14
  if (saida.lote_acabado || saida.quantidade) {
    if (saida.lote_acabado) linha('Lote Acabado', saida.lote_acabado, col1, y)
    if (saida.quantidade)   linha('Quantidade',   saida.quantidade,  col2, y)
    y += 14
  }

  y += 4  // padding após o box

  // ── Box de Volumes ─────────────────────────────────────
  const hasVolBruto = !!(saida.volume_bruto_kg && saida.volume_bruto_kg !== saida.volume_liquido_kg)
  const volBoxH = 7 + 14 + (hasVolBruto ? 0 : 0) + (temAbat ? 16 : 12)
  pdoc.setFillColor(240, 246, 255)
  pdoc.roundedRect(14, y, W - 28, volBoxH, 3, 3, 'F')
  y += 7

  linha('Volume Líquido',
    fmtKg(saida.volume_liquido_kg || saida.volume_bruto_kg), col1, y)

  if (saida.volume_bruto_kg && saida.volume_bruto_kg !== saida.volume_liquido_kg) {
    linha('Volume Bruto', fmtKg(saida.volume_bruto_kg), col2, y)
  }
  y += 14

  const percAbatPDF   = saida.percentual_abatimento || PERCENTUAL_ABATIMENTO
  const percLblPDF    = `${(percAbatPDF * 100).toFixed(1).replace('.', ',')}%`
  const isEsp135612PDF = (saida.tipo_companion === 'rhodia_135612') || ((saida.codigo_material || saida.codigo_produto) === MATERIAL_ESPECIAL_135612.codigo && saida.tipo_companion !== 'oleo_encimagem_nilit')
  const isOleoNilitPDF = saida.tipo_companion === 'oleo_encimagem_nilit'

  if (temAbat) {
    pdoc.setFont('helvetica', 'bold'); pdoc.setFontSize(9); pdoc.setTextColor(...DARK)
    pdoc.text(`Volume a Debitar do Estoque (com abat. ${percLblPDF}):`, col1, y)
    pdoc.setTextColor(...MED)
    pdoc.text(fmtKg(saida.volume_abatido_kg), col1 + 96, y)
    y += 12
  } else {
    pdoc.setFont('helvetica', 'bold'); pdoc.setFontSize(9); pdoc.setTextColor(...DARK)
    pdoc.text('Volume a Debitar do Estoque:', col1, y)
    pdoc.setTextColor(...MED)
    pdoc.text(fmtKg(saida.volume_abatido_kg), col1 + 60, y)
    y += 8
  }

  y += 6

  // ── Tabela FIFO principal ──────────────────────────────
  pdoc.setFillColor(...DARK); pdoc.setTextColor(...WHITE)
  pdoc.setFontSize(10); pdoc.setFont('helvetica', 'bold')
  pdoc.roundedRect(14, y, W - 28, 9, 2, 2, 'F')
  pdoc.text('ALOCAÇÃO NAS NFs DE ENTRADA (FIFO)', W / 2, y + 6, { align: 'center' })
  y += 11

  autoTable(pdoc, {
    startY: y,
    margin: { left: 14, right: 14 },
    head: [['NF de Entrada', 'Data de Emissão', 'Volume Abatido (kg)']],
    body: alocacoes.map(a => [
      a.numero_nf,
      a.data_emissao ? format(new Date(a.data_emissao), 'dd/MM/yyyy') : '—',
      fmtKg(a.volume_alocado_kg),
    ]),
    foot: [[
      { content: 'TOTAL', styles: { fontStyle: 'bold' } }, '',
      { content: fmtKg(alocacoes.reduce((s, a) => s + Number(a.volume_alocado_kg), 0)), styles: { fontStyle: 'bold' } },
    ]],
    headStyles:         { fillColor: MED, textColor: WHITE, fontStyle: 'bold', fontSize: 9 },
    bodyStyles:         { textColor: [30, 30, 60], fontSize: 9 },
    footStyles:         { fillColor: LIGHT, textColor: DARK, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [240, 246, 255] },
    columnStyles:       { 2: { halign: 'right' } },
  })

  // ── Tabela companion — apenas material 135612 ──────────
  if (isEsp135612PDF && alocacoesCompanion.length > 0) {
    y = pdoc.lastAutoTable.finalY + 8

    const AMBER = [180, 100, 0]
    pdoc.setFillColor(...AMBER); pdoc.setTextColor(...WHITE)
    pdoc.setFontSize(9); pdoc.setFont('helvetica', 'bold')
    pdoc.roundedRect(14, y, W - 28, 9, 2, 2, 'F')
    const volAbatTotal = saida.volume_abatimento_kg
      ? fmtKg(saida.volume_abatimento_kg)
      : fmtKg(alocacoesCompanion.reduce((s, a) => s + Number(a.volume_alocado_kg), 0))
    pdoc.text(`ABATIMENTO ÓLEO DE ENCIMAGEM ESPECIAL (${percLblPDF}) — ${volAbatTotal}`, W / 2, y + 6, { align: 'center' })
    y += 11

    // Agrupa por material companion
    const porMaterial = {}
    for (const aloc of alocacoesCompanion) {
      const cod = aloc.codigo_material_companion || aloc.codigo_material || '?'
      if (!porMaterial[cod]) porMaterial[cod] = []
      porMaterial[cod].push(aloc)
    }
    const dist = MATERIAL_ESPECIAL_135612.distribuicao

    const bodyComp = []
    const footTotalComp = { vol: 0 }
    for (const d of dist) {
      const alocs = porMaterial[d.codigo_material] || []
      for (const aloc of alocs) {
        bodyComp.push([
          `${d.codigo_material} (${(d.percentual * 100).toFixed(0)}%)`,
          aloc.numero_nf,
          aloc.data_emissao ? format(new Date(aloc.data_emissao), 'dd/MM/yyyy') : '—',
          fmtKg(aloc.volume_alocado_kg),
        ])
        footTotalComp.vol += Number(aloc.volume_alocado_kg)
      }
    }

    autoTable(pdoc, {
      startY: y,
      margin: { left: 14, right: 14 },
      head: [['Material', 'NF de Entrada', 'Data de Emissão', 'Volume Debitado (kg)']],
      body: bodyComp,
      foot: [[
        { content: 'TOTAL', colSpan: 3, styles: { fontStyle: 'bold' } },
        { content: fmtKg(footTotalComp.vol), styles: { fontStyle: 'bold' } },
      ]],
      headStyles:         { fillColor: [180, 100, 0], textColor: WHITE, fontStyle: 'bold', fontSize: 8 },
      bodyStyles:         { textColor: [30, 30, 60], fontSize: 8 },
      footStyles:         { fillColor: [255, 240, 200], textColor: DARK, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [255, 248, 230] },
      columnStyles:       { 3: { halign: 'right' } },
    })
  }

  // ── Tabela óleo de encimagem (Nilit) — débito do material 23033 ──────────
  if (isOleoNilitPDF && alocacoesCompanion.length > 0) {
    y = pdoc.lastAutoTable.finalY + 8

    const AMBER = [180, 100, 0]
    pdoc.setFillColor(...AMBER); pdoc.setTextColor(...WHITE)
    pdoc.setFontSize(9); pdoc.setFont('helvetica', 'bold')
    pdoc.roundedRect(14, y, W - 28, 9, 2, 2, 'F')
    const volOleoTotal = saida.volume_abatimento_kg
      ? fmtKg(saida.volume_abatimento_kg)
      : fmtKg(alocacoesCompanion.reduce((s, a) => s + Number(a.volume_alocado_kg), 0))
    const skOleoLbl = saida.codigo_sankhia_oleo ? ` (SK ${saida.codigo_sankhia_oleo})` : ''
    pdoc.text(`ÓLEO DE ENCIMAGEM (${percLblPDF}) — ${MATERIAL_OLEO_ENCIMAGEM_NILIT.codigo}${skOleoLbl} ${MATERIAL_OLEO_ENCIMAGEM_NILIT.descricao} — ${volOleoTotal}`, W / 2, y + 6, { align: 'center' })
    y += 11

    autoTable(pdoc, {
      startY: y,
      margin: { left: 14, right: 14 },
      head: [['NF de Entrada', 'Data de Emissão', 'Volume Debitado (kg)']],
      body: alocacoesCompanion.map(a => [
        a.numero_nf,
        a.data_emissao ? format(new Date(a.data_emissao), 'dd/MM/yyyy') : '—',
        fmtKg(a.volume_alocado_kg),
      ]),
      foot: [[
        { content: 'TOTAL', colSpan: 2, styles: { fontStyle: 'bold' } },
        { content: fmtKg(alocacoesCompanion.reduce((s, a) => s + Number(a.volume_alocado_kg), 0)), styles: { fontStyle: 'bold' } },
      ]],
      headStyles:         { fillColor: [180, 100, 0], textColor: WHITE, fontStyle: 'bold', fontSize: 9 },
      bodyStyles:         { textColor: [30, 30, 60], fontSize: 9 },
      footStyles:         { fillColor: [255, 240, 200], textColor: DARK, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [255, 248, 230] },
      columnStyles:       { 2: { halign: 'right' } },
    })
  }

  // ── Assinatura ─────────────────────────────────────────
  const signY = pdoc.lastAutoTable.finalY + 14
  pdoc.setDrawColor(...MED); pdoc.setLineWidth(0.3)
  pdoc.line(14, signY, 90, signY)
  pdoc.line(W / 2 + 10, signY, W - 14, signY)
  pdoc.setFontSize(8); pdoc.setTextColor(100, 100, 100); pdoc.setFont('helvetica', 'normal')
  pdoc.text('Responsável pela Saída', 52, signY + 5, { align: 'center' })
  pdoc.text('Conferente / Aprovação', W / 2 + 10 + 34, signY + 5, { align: 'center' })

  // ── Rodapé ─────────────────────────────────────────────
  const pH = pdoc.internal.pageSize.height
  pdoc.setFillColor(...DARK)
  pdoc.rect(0, pH - 12, W, 12, 'F')
  pdoc.setTextColor(...WHITE); pdoc.setFontSize(7); pdoc.setFont('helvetica', 'normal')
  pdoc.text('Corradi Mazzer — Sistema de Controle de Façonagem', W / 2, pH - 4, { align: 'center' })

  return pdoc
}

export function gerarRomaneioPDF(saida, alocacoes, config = {}, alocacoesCompanion = []) {
  const pdoc = _buildRomaneioPDF(saida, alocacoes, config, alocacoesCompanion)
  pdoc.save(`romaneio_${saida.romaneio_microdata}_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`)
}

export function gerarRomaneioBase64(saida, alocacoes, config = {}, alocacoesCompanion = []) {
  const pdoc = _buildRomaneioPDF(saida, alocacoes, config, alocacoesCompanion)
  return pdoc.output('datauristring').split(',')[1]
}

// ─────────────────────────────────────────────────────────────────
// ROMANEIO MULTI-SAÍDA PDF (1 romaneio com múltiplos materiais)
// ─────────────────────────────────────────────────────────────────

function _buildMultiSaidaPDF(dados, config = {}) {
  // dados: { romaneio_microdata, tipo_saida, lote_acabado, itens, criado_em }
  // itens: [{ codigo_material, lote_poy, descricao_material, volume_liquido_kg, volume_abatido_kg, alocacoes, alocacoesCompanion }]
  const pdoc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W     = 210
  const DARK  = [15, 40, 80]
  const MED   = [26, 80, 150]
  const LIGHT = [220, 235, 255]
  const WHITE = [255, 255, 255]
  const GRAY  = [80, 80, 80]

  const tipoLbl  = TIPOS_SAIDA.find(t => t.value === dados.tipo_saida)?.label || dados.tipo_saida
  const temAbat  = TIPOS_COM_ABATIMENTO.includes(dados.tipo_saida)
  const fmtVol   = n => n != null ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
  const totalLiq = dados.itens.reduce((a, i) => a + Number(i.volume_liquido_kg || 0), 0)
  const totalFin = dados.itens.reduce((a, i) => a + Number(i.volume_abatido_kg || i.volume_liquido_kg || 0), 0)
  const tituloPDF = dados.itens.length === 1 ? 'ROMANEIO DE SAÍDA' : 'ROMANEIO DE SAÍDA MÚLTIPLA'

  // ── Cabeçalho ──
  const headerH = 36
  pdoc.setFillColor(...DARK)
  pdoc.rect(0, 0, W, headerH, 'F')
  if (config.logoBase64) {
    try { pdoc.addImage(config.logoBase64, 'PNG', 14, 5, 26, 26) } catch (_) {}
  }
  pdoc.setTextColor(...WHITE)
  pdoc.setFontSize(16); pdoc.setFont('helvetica', 'bold')
  pdoc.text('CORRADI MAZZER — FAÇONAGEM', W / 2, 13, { align: 'center' })
  pdoc.setFontSize(10); pdoc.setFont('helvetica', 'normal')
  pdoc.text(tituloPDF, W / 2, 21, { align: 'center' })
  pdoc.setFontSize(8)
  pdoc.text(`Emitido: ${format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`, W / 2, 29, { align: 'center' })

  let y = headerH + 8

  // ── Box cabeçalho romaneio ──
  pdoc.setFillColor(...LIGHT)
  pdoc.roundedRect(14, y, W - 28, 28, 3, 3, 'F')
  const linha = (lbl, val, cx, cy) => {
    pdoc.setFont('helvetica', 'bold'); pdoc.setFontSize(8); pdoc.setTextColor(...GRAY)
    pdoc.text(lbl, cx, cy)
    pdoc.setFont('helvetica', 'normal'); pdoc.setTextColor(...DARK)
    pdoc.text(String(val ?? '—'), cx, cy + 5)
  }
  const col1 = 20, col2 = W / 2 + 4
  y += 7
  linha('Romaneio Microdata', dados.romaneio_microdata, col1, y)
  linha('Tipo de Saída',      tipoLbl,                  col2, y)
  y += 14
  linha('Lote Acabado', dados.lote_acabado || '—',      col1, y)
  linha('Data/Hora',    dados.criado_em
    ? format(new Date(dados.criado_em), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
    : format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }), col2, y)
  y += 14

  // ── Tabela de itens ──
  autoTable(pdoc, {
    startY: y,
    margin: { left: 14, right: 14 },
    head: [['Cód. Material', 'Cód. Sankhia', 'Lote POY', 'Descrição', 'Volume Líq.', temAbat ? 'Vol. Debitado' : 'Volume']],
    body: dados.itens.map(it => [
      it.codigo_material || '—',
      it.codigo_sankhia || '—',
      it.lote_poy || '—',
      it.descricao_material || '—',
      fmtVol(it.volume_liquido_kg),
      fmtVol(it.volume_abatido_kg ?? it.volume_liquido_kg),
    ]),
    foot: [[
      { content: `Total — ${dados.itens.length} item(ns)`, colSpan: 4, styles: { fontStyle: 'bold' } },
      { content: fmtVol(totalLiq), styles: { fontStyle: 'bold', halign: 'right' } },
      { content: fmtVol(totalFin), styles: { fontStyle: 'bold', halign: 'right', textColor: MED } },
    ]],
    styles:     { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: DARK, textColor: WHITE, fontStyle: 'bold' },
    footStyles: { fillColor: LIGHT, textColor: DARK },
    alternateRowStyles: { fillColor: [245, 249, 255] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 24 },
      1: { fontStyle: 'bold', cellWidth: 22, textColor: MED },
      2: { cellWidth: 20 },
      3: { cellWidth: 'auto' },
      4: { halign: 'right', cellWidth: 24 },
      5: { halign: 'right', cellWidth: 26 },
    },
  })

  // ── Detalhamento FIFO — NFs de origem por item ──
  const fifoRows = []
  let fifoTotal = 0
  for (const it of dados.itens) {
    for (const a of (it.alocacoes || [])) {
      fifoRows.push([
        it.codigo_material || '—',
        it.codigo_sankhia || '—',
        it.lote_poy || '—',
        a.numero_nf,
        a.data_emissao ? format(new Date(a.data_emissao), 'dd/MM/yyyy') : '—',
        fmtVol(a.volume_alocado_kg),
      ])
      fifoTotal += Number(a.volume_alocado_kg) || 0
    }
  }

  if (fifoRows.length > 0) {
    let yFifo = pdoc.lastAutoTable.finalY + 8
    pdoc.setFillColor(...DARK); pdoc.setTextColor(...WHITE)
    pdoc.setFontSize(10); pdoc.setFont('helvetica', 'bold')
    pdoc.roundedRect(14, yFifo, W - 28, 9, 2, 2, 'F')
    pdoc.text('DETALHAMENTO FIFO — NFs DE ORIGEM POR ITEM', W / 2, yFifo + 6, { align: 'center' })
    yFifo += 11

    autoTable(pdoc, {
      startY: yFifo,
      margin: { left: 14, right: 14 },
      head: [['Cód. Material', 'Cód. Sankhia', 'Lote POY', 'NF de Entrada', 'Emissão', 'Vol. Debitado']],
      body: fifoRows,
      foot: [[
        { content: 'TOTAL', colSpan: 5, styles: { fontStyle: 'bold' } },
        { content: fmtVol(fifoTotal), styles: { fontStyle: 'bold', halign: 'right' } },
      ]],
      styles:     { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: MED, textColor: WHITE, fontStyle: 'bold' },
      footStyles: { fillColor: LIGHT, textColor: DARK },
      alternateRowStyles: { fillColor: [245, 249, 255] },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 24 },
        1: { fontStyle: 'bold', cellWidth: 22, textColor: MED },
        2: { cellWidth: 20 },
        3: { cellWidth: 28, fontStyle: 'bold' },
        4: { cellWidth: 24 },
        5: { halign: 'right', cellWidth: 'auto' },
      },
    })
  }

  // ── Detalhamento Óleo de Encimagem (Nilit) ──
  const oleoRows = []
  for (const it of dados.itens) {
    for (const a of (it.alocacoesCompanion || [])) {
      if ((a.codigo_material_companion || a.codigo_material) === MATERIAL_OLEO_ENCIMAGEM_NILIT.codigo) {
        oleoRows.push([
          it.codigo_material || '—',
          a.numero_nf,
          a.data_emissao ? format(new Date(a.data_emissao), 'dd/MM/yyyy') : '—',
          fmtVol(a.volume_alocado_kg),
        ])
      }
    }
  }

  if (oleoRows.length > 0) {
    let yOleo = pdoc.lastAutoTable.finalY + 8
    const AMBER = [180, 100, 0]
    pdoc.setFillColor(...AMBER); pdoc.setTextColor(...WHITE)
    pdoc.setFontSize(9); pdoc.setFont('helvetica', 'bold')
    pdoc.roundedRect(14, yOleo, W - 28, 9, 2, 2, 'F')
    const skOleoLblMulti = dados.codigo_sankhia_oleo ? ` (SK ${dados.codigo_sankhia_oleo})` : ''
    pdoc.text(`ÓLEO DE ENCIMAGEM — ${MATERIAL_OLEO_ENCIMAGEM_NILIT.codigo}${skOleoLblMulti} ${MATERIAL_OLEO_ENCIMAGEM_NILIT.descricao}`, W / 2, yOleo + 6, { align: 'center' })
    yOleo += 11

    autoTable(pdoc, {
      startY: yOleo,
      margin: { left: 14, right: 14 },
      head: [['Item (Cód. Mat.)', 'NF de Entrada', 'Emissão', 'Vol. Debitado']],
      body: oleoRows,
      styles:     { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: AMBER, textColor: WHITE, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [255, 248, 230] },
      columnStyles: { 3: { halign: 'right' } },
    })
  }

  return pdoc
}

export function gerarMultiSaidaPDF(dados, config = {}) {
  const pdoc = _buildMultiSaidaPDF(dados, config)
  pdoc.save(`romaneio_multi_${dados.romaneio_microdata}_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`)
}

// ── 6. Romaneio XLSX (Exportação individual e múltipla) ──────────

export function gerarRomaneioXLSX(saida, alocacoes, config = {}, alocacoesCompanion = []) {
  const wb = XLSX.utils.book_new()
  const tipoLbl = TIPOS_SAIDA.find(t => t.value === saida.tipo_saida)?.label || saida.tipo_saida
  const fmtV = n => n != null ? Number(n) : 0

  const rows = [
    ['CORRADI MAZZER — FAÇONAGEM'],
    ['ROMANEIO DE SAÍDA'],
    [`Emitido em: ${format(new Date(), "dd/MM/yyyy HH:mm")}`],
    [],
    ['DADOS DO ROMANEIO'],
    ['Romaneio Microdata', saida.romaneio_microdata || '—'],
    ['Código do Material', saida.codigo_material || saida.codigo_produto || '—'],
    ['Código Sankhia', saida.codigo_sankhia || '—'],
    ['Descrição', saida.descricao_material || '—'],
    ['Lote POY', saida.lote_poy || '—'],
    ['Lote Acabado', saida.lote_acabado || '—'],
    ['Tipo de Saída', tipoLbl],
    ['Quantidade', saida.quantidade || '—'],
    [],
    ['VOLUMES'],
    ['Volume Líquido (kg)', fmtV(saida.volume_liquido_kg || saida.volume_bruto_kg)],
    ['Volume Bruto (kg)', fmtV(saida.volume_bruto_kg)],
    ['Volume a Debitar do Estoque (kg)', fmtV(saida.volume_abatido_kg)],
    [],
    ['ALOCAÇÃO NAS NFs DE ENTRADA (FIFO)'],
    ['NF de Entrada', 'Data de Emissão', 'Volume Alocado (kg)']
  ]

  alocacoes.forEach(a => {
    rows.push([
      a.numero_nf,
      a.data_emissao ? format(new Date(a.data_emissao), 'dd/MM/yyyy') : '—',
      fmtV(a.volume_alocado_kg)
    ])
  })

  // Se houver companion (Óleo de Encimagem / Especial 135612)
  if (alocacoesCompanion.length > 0) {
    const isOleoNilit = saida.tipo_companion === 'oleo_encimagem_nilit'
    const skOleoLblXLSX = saida.codigo_sankhia_oleo ? ` (SK ${saida.codigo_sankhia_oleo})` : ''
    rows.push([])
    rows.push([isOleoNilit
      ? `DETALHAMENTO ÓLEO DE ENCIMAGEM — ${MATERIAL_OLEO_ENCIMAGEM_NILIT.codigo}${skOleoLblXLSX} ${MATERIAL_OLEO_ENCIMAGEM_NILIT.descricao}`
      : 'DETALHAMENTO ABATIMENTO ESPECIAL'])
    rows.push(['Material', 'NF de Entrada', 'Data de Emissão', 'Volume Debitado (kg)'])
    alocacoesCompanion.forEach(a => {
      rows.push([
        a.codigo_material_companion || a.codigo_material || '—',
        a.numero_nf,
        a.data_emissao ? format(new Date(a.data_emissao), 'dd/MM/yyyy') : '—',
        fmtV(a.volume_alocado_kg)
      ])
    })
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  // Ajuste de colunas
  ws['!cols'] = [{ wch: 30 }, { wch: 40 }, { wch: 20 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Romaneio')

  XLSX.writeFile(wb, `romaneio_${saida.romaneio_microdata}_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`)
}

export function gerarMultiSaidaXLSX(dados, config = {}) {
  const wb = XLSX.utils.book_new()
  const tipoLbl = TIPOS_SAIDA.find(t => t.value === dados.tipo_saida)?.label || dados.tipo_saida
  const fmtV = n => n != null ? Number(n) : 0

  // Aba 1: Resumo dos Itens
  const resumoRows = [
    ['ROMANEIO DE SAÍDA MÚLTIPLA — CORRADI MAZZER'],
    [`Romaneio: ${dados.romaneio_microdata}`],
    [`Tipo: ${tipoLbl}`],
    [`Data: ${dados.criado_em ? format(new Date(dados.criado_em), "dd/MM/yyyy HH:mm") : format(new Date(), "dd/MM/yyyy HH:mm")}`],
    [],
    ['Cód. Material', 'Cód. Sankhia', 'Lote POY', 'Descrição', 'Volume Líquido', 'Volume Debitado']
  ]

  dados.itens.forEach(it => {
    resumoRows.push([
      it.codigo_material || '—',
      it.codigo_sankhia || '—',
      it.lote_poy || '—',
      it.descricao_material || '—',
      fmtV(it.volume_liquido_kg),
      fmtV(it.volume_abatido_kg ?? it.volume_liquido_kg)
    ])
  })

  const wsResumo = XLSX.utils.aoa_to_sheet(resumoRows)
  wsResumo['!cols'] = [{wch:15}, {wch:15}, {wch:12}, {wch:35}, {wch:15}, {wch:15}]
  XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo Itens')

  // Aba 2: Detalhamento FIFO
  const fifoRows = [['Cód. Material', 'Lote POY', 'NF Entrada', 'Data Emissão', 'Vol. Debitado (kg)']]
  dados.itens.forEach(it => {
    ;(it.alocacoes || []).forEach(a => {
      fifoRows.push([
        it.codigo_material || '—',
        it.lote_poy || '—',
        a.numero_nf,
        a.data_emissao ? format(new Date(a.data_emissao), 'dd/MM/yyyy') : '—',
        fmtV(a.volume_alocado_kg)
      ])
    })
  })

  const wsFIFO = XLSX.utils.aoa_to_sheet(fifoRows)
  wsFIFO['!cols'] = [{wch:15}, {wch:12}, {wch:15}, {wch:15}, {wch:18}]
  XLSX.utils.book_append_sheet(wb, wsFIFO, 'Detalhamento FIFO')

  // Aba 3: Companion (se houver)
  const compRows = []
  if (dados.codigo_sankhia_oleo) {
    compRows.push([`ÓLEO DE ENCIMAGEM — ${MATERIAL_OLEO_ENCIMAGEM_NILIT.codigo} (SK ${dados.codigo_sankhia_oleo}) ${MATERIAL_OLEO_ENCIMAGEM_NILIT.descricao}`])
    compRows.push([])
  }
  compRows.push(['Item (Mat.)', 'Material Companion', 'NF Entrada', 'Data Emissão', 'Vol. Debitado (kg)'])
  let temComp = false
  dados.itens.forEach(it => {
    ;(it.alocacoesCompanion || []).forEach(a => {
      temComp = true
      compRows.push([
        it.codigo_material || '—',
        a.codigo_material_companion || a.codigo_material || '—',
        a.numero_nf,
        a.data_emissao ? format(new Date(a.data_emissao), 'dd/MM/yyyy') : '—',
        fmtV(a.volume_alocado_kg)
      ])
    })
  })

  if (temComp) {
    const wsComp = XLSX.utils.aoa_to_sheet(compRows)
    wsComp['!cols'] = [{wch:15}, {wch:20}, {wch:15}, {wch:15}, {wch:18}]
    XLSX.utils.book_append_sheet(wb, wsComp, 'Detalhamento Companion')
  }

  XLSX.writeFile(wb, `romaneio_multi_${dados.romaneio_microdata}_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`)
}



// ─────────────────────────────────────────────────────────────────
// HISTÓRICO DE EDIÇÕES DE NF
// ─────────────────────────────────────────────────────────────────

export async function registrarEdicaoNF(nfId, dadosAntes, dadosDepois, usuario, colecoes = COLECOES_PADRAO) {
  await addDoc(collection(db, colecoes.nf_historico), {
    nf_id: nfId,
    dados_antes: dadosAntes,
    dados_depois: dadosDepois,
    usuario_email: usuario?.email || '',
    editado_em: Timestamp.now(),
  })
}

export async function listarHistoricoNF(nfId, colecoes = COLECOES_PADRAO) {
  const snap = await getDocs(
    query(collection(db, colecoes.nf_historico), where('nf_id', '==', nfId))
  )
  return snap.docs
    .map(d => ({ id: d.id, ...d.data(), editado_em: tsToDateTime(d.data().editado_em) }))
    .sort((a, b) => (b.editado_em || '').localeCompare(a.editado_em || ''))
}

// ─────────────────────────────────────────────────────────────────
// SAÍDA EM LOTE (múltiplos romaneios de uma vez)
// ─────────────────────────────────────────────────────────────────

export async function criarSaidasEmLote(saidas, usuario, colecoes = COLECOES_PADRAO) {
  const resultados = []
  for (const saida of saidas) {
    const result = await criarSaida(saida, usuario, colecoes)
    resultados.push(result)
  }
  await registrarLog('SAIDA_LOTE', `${saidas.length} saídas registradas em lote`, usuario, colecoes)
  return resultados
}

// ─────────────────────────────────────────────────────────────────
// RELATÓRIO MENSAL PDF
// ─────────────────────────────────────────────────────────────────

export function gerarRelatorioPDF(nfs, saidas, mes, ano, config = {}) {
  const pdoc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W     = 210
  const DARK  = [15, 40, 80]
  const MED   = [26, 80, 150]
  const LIGHT = [220, 235, 255]
  const WHITE = [255, 255, 255]
  const fmtN  = n => Number(n||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const mesLabel = mes ? format(new Date(ano, mes - 1, 1), 'MMMM yyyy', { locale: ptBR }) : `${ano}`

  // Filtra NFs e saídas pelo mesmo período
  const nfsFiltradas = mes
    ? nfs.filter(n => { const d = new Date(n.data_emissao); return d.getMonth()+1 === mes && d.getFullYear() === ano })
    : nfs.filter(n => { const d = new Date(n.data_emissao); return d.getFullYear() === ano })
  const saidasFiltradas = mes
    ? saidas.filter(s => { const d = new Date(s.criado_em); return d.getMonth()+1 === mes && d.getFullYear() === ano })
    : saidas.filter(s => { const d = new Date(s.criado_em); return d.getFullYear() === ano })

  // Cabeçalho
  pdoc.setFillColor(...DARK); pdoc.rect(0, 0, W, 32, 'F')
  pdoc.setTextColor(...WHITE)
  pdoc.setFontSize(16); pdoc.setFont('helvetica', 'bold')
  pdoc.text('CORRADI MAZZER — FAÇONAGEM', W/2, 12, { align: 'center' })
  pdoc.setFontSize(10); pdoc.setFont('helvetica', 'normal')
  pdoc.text(`RELATÓRIO MENSAL — ${mesLabel.toUpperCase()}`, W/2, 21, { align: 'center' })
  pdoc.setFontSize(8)
  pdoc.text(`Emitido: ${format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`, W/2, 28, { align: 'center' })

  let y = 40

  // KPIs resumo — base = NFs do período selecionado
  const totalEntrada = nfsFiltradas.reduce((a,n) => a + Number(n.volume_kg), 0)
  const totalSaldo   = nfsFiltradas.reduce((a,n) => a + Number(n.volume_saldo_kg), 0)
  const totalFat  = saidasFiltradas.filter(s => s.tipo_saida === 'faturamento').reduce((a,s) => a + Number(s.volume_abatido_kg), 0)
  const totalDev  = saidasFiltradas.filter(s => s.tipo_saida?.startsWith('dev_')).reduce((a,s) => a + Number(s.volume_abatido_kg), 0)
  const totalSuc  = saidasFiltradas.filter(s => ['sucata','estopa'].includes(s.tipo_saida)).reduce((a,s) => a + Number(s.volume_abatido_kg), 0)
  const totalSaida = saidasFiltradas.reduce((a,s) => a + Number(s.volume_abatido_kg), 0)
  const base = totalEntrada // denominador para todos os %

  const kpis = [
    ['Total Entrada (kg)',    fmtN(totalEntrada)],
    ['Total Saídas (kg)',     fmtN(totalSaida)],
    ['Faturamento (kg)',      fmtN(totalFat)],
    ['Devolução (kg)',        fmtN(totalDev)],
    ['Sucata/Estopa (kg)',    fmtN(totalSuc)],
    ['Saldo Atual (kg)',      fmtN(totalSaldo)],
  ]
  pdoc.setFillColor(...LIGHT); pdoc.roundedRect(14, y, W-28, 36, 3, 3, 'F')
  kpis.forEach(([lbl, val], i) => {
    const col = i % 3 === 0 ? 20 : i % 3 === 1 ? W/2 - 15 : W - 80
    const row = y + 8 + Math.floor(i/3) * 14
    pdoc.setFont('helvetica', 'bold'); pdoc.setFontSize(7); pdoc.setTextColor(80,80,80)
    pdoc.text(lbl, col, row)
    pdoc.setFont('helvetica', 'normal'); pdoc.setFontSize(9); pdoc.setTextColor(...DARK)
    pdoc.text(val, col, row + 5)
  })
  y += 44

  // Tabela NFs Entrada
  pdoc.setFillColor(...DARK); pdoc.setTextColor(...WHITE)
  pdoc.setFontSize(9); pdoc.setFont('helvetica', 'bold')
  pdoc.roundedRect(14, y, W-28, 8, 2, 2, 'F')
  pdoc.text('NFs DE ENTRADA', W/2, y+5.5, { align: 'center' })
  y += 10

  autoTable(pdoc, {
    startY: y, margin: { left: 14, right: 14 },
    head: [['NF', 'Emissão', 'Cód. Material', 'Lote', 'Volume (kg)', 'Saldo (kg)']],
    body: nfsFiltradas.map(n => [
      n.numero_nf,
      n.data_emissao ? format(new Date(n.data_emissao), 'dd/MM/yyyy') : '—',
      n.codigo_material || '—',
      n.lote || '—',
      fmtN(n.volume_kg),
      fmtN(n.volume_saldo_kg),
    ]),
    headStyles: { fillColor: MED, textColor: WHITE, fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [240, 246, 255] },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' } },
  })
  y = pdoc.lastAutoTable.finalY + 8

  // Tabela Saídas
  if (y > 220) { pdoc.addPage(); y = 20 }
  pdoc.setFillColor(...DARK); pdoc.setTextColor(...WHITE)
  pdoc.setFontSize(9); pdoc.setFont('helvetica', 'bold')
  pdoc.roundedRect(14, y, W-28, 8, 2, 2, 'F')
  pdoc.text('SAÍDAS DO PERÍODO', W/2, y+5.5, { align: 'center' })
  y += 10

  autoTable(pdoc, {
    startY: y, margin: { left: 14, right: 14 },
    head: [['Romaneio', 'Material', 'Lote', 'Tipo', 'Vol. Final (kg)', 'Data']],
    body: saidasFiltradas.map(s => [
      s.romaneio_microdata,
      s.codigo_material || s.codigo_produto || '—',
      s.lote_poy || '—',
      TIPOS_SAIDA.find(t => t.value === s.tipo_saida)?.label || s.tipo_saida,
      fmtN(s.volume_abatido_kg),
      s.criado_em ? format(new Date(s.criado_em), 'dd/MM/yyyy') : '—',
    ]),
    headStyles: { fillColor: MED, textColor: WHITE, fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [240, 246, 255] },
    columnStyles: { 4: { halign: 'right' } },
  })

  y = pdoc.lastAutoTable.finalY + 8

  // ── KPIs consolidados por tipo ─────────────────────────────────
  if (y > 220) { pdoc.addPage(); y = 20 }
  pdoc.setFillColor(...DARK); pdoc.setTextColor(...WHITE)
  pdoc.setFontSize(9); pdoc.setFont('helvetica', 'bold')
  pdoc.roundedRect(14, y, W-28, 8, 2, 2, 'F')
  pdoc.text('KPIs CONSOLIDADOS — % SOBRE ENTRADA', W/2, y+5.5, { align: 'center' })
  y += 10

  const pctStr = (v, t) => t > 0 ? ((v/t)*100).toFixed(1) + '%' : '0.0%'
  const devQual  = saidasFiltradas.filter(s => s.tipo_saida === 'dev_qualidade').reduce((a,s) => a + Number(s.volume_abatido_kg), 0)
  const devProc  = saidasFiltradas.filter(s => s.tipo_saida === 'dev_processo').reduce((a,s) => a + Number(s.volume_abatido_kg), 0)
  const devFinal = saidasFiltradas.filter(s => s.tipo_saida === 'dev_final_campanha').reduce((a,s) => a + Number(s.volume_abatido_kg), 0)
  const soSucata = saidasFiltradas.filter(s => s.tipo_saida === 'sucata').reduce((a,s) => a + Number(s.volume_abatido_kg), 0)
  const soEstopa = saidasFiltradas.filter(s => s.tipo_saida === 'estopa').reduce((a,s) => a + Number(s.volume_abatido_kg), 0)

  autoTable(pdoc, {
    startY: y, margin: { left: 14, right: 14 },
    head: [['Categoria', 'Volume (kg)', '% Entrada']],
    body: [
      ['Faturamento',             fmtN(totalFat),   pctStr(totalFat,   base)],
      ['Devolução Total',         fmtN(totalDev),   pctStr(totalDev,   base)],
      ['  • Dev. Qualidade',      fmtN(devQual),    pctStr(devQual,    base)],
      ['  • Dev. Processo',       fmtN(devProc),    pctStr(devProc,    base)],
      ['  • Dev. Final Campanha', fmtN(devFinal),   pctStr(devFinal,   base)],
      ['Sucata + Estopa',         fmtN(totalSuc),   pctStr(totalSuc,   base)],
      ['  • Sucata',              fmtN(soSucata),   pctStr(soSucata,   base)],
      ['  • Estopa',              fmtN(soEstopa),   pctStr(soEstopa,   base)],
      ['Saldo em Estoque',        fmtN(totalSaldo), pctStr(totalSaldo, base)],
    ],
    headStyles: { fillColor: MED, textColor: WHITE, fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [240, 246, 255] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
  })
  y = pdoc.lastAutoTable.finalY + 8

  // ── KPIs por Lote ──────────────────────────────────────────────
  if (y > 220) { pdoc.addPage(); y = 20 }
  pdoc.setFillColor(...DARK); pdoc.setTextColor(...WHITE)
  pdoc.setFontSize(9); pdoc.setFont('helvetica', 'bold')
  pdoc.roundedRect(14, y, W-28, 8, 2, 2, 'F')
  pdoc.text('KPIs POR LOTE POY', W/2, y+5.5, { align: 'center' })
  y += 10

  // Agrupa por lote — NFs e saídas do mesmo período filtrado
  const lotes = {}
  for (const nf of nfsFiltradas) {
    const k = nf.lote || '(sem lote)'
    if (!lotes[k]) lotes[k] = { entradaKg:0, fat:0, dev:0, suc:0 }
    lotes[k].entradaKg += Number(nf.volume_kg||0)
  }
  for (const s of saidasFiltradas) {
    const k = s.lote_poy || s.lote_produto || '(sem lote)'
    if (!lotes[k]) lotes[k] = { entradaKg:0, fat:0, dev:0, suc:0 }
    const v = Number(s.volume_abatido_kg||0)
    if (s.tipo_saida === 'faturamento')                   lotes[k].fat += v
    else if (s.tipo_saida?.startsWith('dev_'))            lotes[k].dev += v
    else if (['sucata','estopa'].includes(s.tipo_saida))  lotes[k].suc += v
  }

  const loteRows = Object.entries(lotes).sort((a,b) => b[1].entradaKg - a[1].entradaKg)
    .map(([lote, g]) => [
      lote,
      fmtN(g.entradaKg),
      fmtN(g.fat),  pctStr(g.fat, g.entradaKg),
      fmtN(g.dev),  pctStr(g.dev, g.entradaKg),
      fmtN(g.suc),  pctStr(g.suc, g.entradaKg),
    ])

  autoTable(pdoc, {
    startY: y, margin: { left: 14, right: 14 },
    head: [['Lote', 'Entrada kg', 'Fat. kg', 'Fat. %', 'Dev. kg', 'Dev. %', 'Suc. kg', 'Suc. %']],
    body: loteRows,
    headStyles: { fillColor: MED, textColor: WHITE, fontSize: 7 },
    bodyStyles: { fontSize: 7 },
    alternateRowStyles: { fillColor: [240, 246, 255] },
    columnStyles: {
      1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' },
      4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' },
    },
  })

  // Rodapé em todas as páginas
  const totalPages = pdoc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    pdoc.setPage(p)
    const pH = pdoc.internal.pageSize.height
    pdoc.setFillColor(...DARK)
    pdoc.rect(0, pH-10, W, 10, 'F')
    pdoc.setTextColor(...WHITE); pdoc.setFontSize(7); pdoc.setFont('helvetica', 'normal')
    pdoc.text(`Corradi Mazzer — Controle de Façonagem  |  Pág. ${p}/${totalPages}`, W/2, pH-3, { align: 'center' })
  }

  pdoc.save(`relatorio_${ano}${mes ? '_' + String(mes).padStart(2,'0') : ''}.pdf`)
}

// ─────────────────────────────────────────────────────────────────
// INVENTÁRIO FÍSICO
// ─────────────────────────────────────────────────────────────────

// Salva um inventário no Firestore
export async function salvarInventario(unidadeId, linhas, usuario, colecoes = COLECOES_PADRAO) {
  const now = Timestamp.now()
  const ref = await addDoc(collection(db, colecoes.inventario), {
    unidade_id:  unidadeId,
    criado_em:   now,
    criado_por:  usuario?.email || '',
    linhas: linhas.map(l => ({
      lote:          l.lote,
      saldo_teorico: l.saldo_teorico,
      contagem_kg:   l.contagem_kg,
      divergencia_kg: l.divergencia_kg,
      divergencia_pct: l.divergencia_pct,
    }))
  })
  await registrarLog(
    'INVENTARIO_SALVO',
    `Inventário com ${linhas.length} lotes — divergência total: ${linhas.reduce((a,l)=>a+Math.abs(l.divergencia_kg),0).toFixed(2)} kg`,
    usuario,
    colecoes
  )
  return ref.id
}

// Lista inventários históricos da unidade
export async function listarInventarios(unidadeId, colecoes = COLECOES_PADRAO) {
  const snap = await getDocs(
    query(collection(db, colecoes.inventario), orderBy('criado_em', 'desc'))
  )
  const todos = snap.docs.map(d => ({ id: d.id, ...d.data(), criado_em: tsToDateTime(d.data().criado_em) }))
  if (!unidadeId) return todos
  return todos.filter(i => (i.unidade_id || '') === unidadeId)
}

// Gera PDF do inventário
export function gerarInventarioPDF(linhas, unidadeId, dataStr) {
  const pdoc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const W = pdoc.internal.pageSize.width
  const DARK = [15, 32, 60], MED = [30, 60, 114], WHITE = [255, 255, 255]

  pdoc.setFillColor(...DARK); pdoc.rect(0, 0, W, 28, 'F')
  pdoc.setTextColor(...WHITE)
  pdoc.setFontSize(14); pdoc.setFont('helvetica', 'bold')
  pdoc.text('CORRADI MAZZER — INVENTÁRIO FÍSICO', W/2, 11, { align: 'center' })
  pdoc.setFontSize(9); pdoc.setFont('helvetica', 'normal')
  pdoc.text(`Data: ${dataStr}  |  Unidade: ${unidadeId || 'Todas'}  |  Emitido em: ${format(new Date(), "dd/MM/yyyy 'às' HH:mm", {locale:ptBR})}`, W/2, 20, { align: 'center' })

  const fmtN = n => Number(n||0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})
  const totalTeorico   = linhas.reduce((a,l) => a + l.saldo_teorico, 0)
  const totalFisico    = linhas.reduce((a,l) => a + l.contagem_kg, 0)
  const totalDiverg    = totalFisico - totalTeorico
  const divergPct      = totalTeorico > 0 ? (totalDiverg / totalTeorico * 100) : 0

  autoTable(pdoc, {
    startY: 32, margin: { left: 10, right: 10 },
    head: [['Lote POY', 'Saldo Teórico (kg)', 'Contagem Física (kg)', 'Divergência (kg)', 'Divergência (%)', 'Status']],
    body: linhas.map(l => [
      l.lote,
      fmtN(l.saldo_teorico),
      fmtN(l.contagem_kg),
      (l.divergencia_kg >= 0 ? '+' : '') + fmtN(l.divergencia_kg),
      (l.divergencia_pct >= 0 ? '+' : '') + Number(l.divergencia_pct).toFixed(2) + '%',
      Math.abs(l.divergencia_pct) < 0.5 ? 'OK' : Math.abs(l.divergencia_pct) < 2 ? 'ATENÇÃO' : 'CRÍTICO'
    ]),
    foot: [[
      'TOTAL',
      fmtN(totalTeorico),
      fmtN(totalFisico),
      (totalDiverg >= 0 ? '+' : '') + fmtN(totalDiverg),
      (divergPct >= 0 ? '+' : '') + divergPct.toFixed(2) + '%',
      ''
    ]],
    headStyles: { fillColor: MED, textColor: WHITE, fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 9 },
    footStyles: { fillColor: DARK, textColor: WHITE, fontSize: 9, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [240, 246, 255] },
    columnStyles: {
      1: { halign: 'right' }, 2: { halign: 'right' },
      3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'center' }
    },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index === 5) {
        const v = data.cell.raw
        if (v === 'CRÍTICO') data.cell.styles.textColor = [200, 30, 30]
        else if (v === 'ATENÇÃO') data.cell.styles.textColor = [180, 120, 0]
        else data.cell.styles.textColor = [0, 140, 70]
      }
      if (data.section === 'body' && data.column.index === 3) {
        const raw = String(data.cell.raw)
        if (raw.startsWith('-')) data.cell.styles.textColor = [200, 30, 30]
        else if (raw.startsWith('+') && raw !== '+0,00') data.cell.styles.textColor = [0, 140, 70]
      }
    }
  })

  const pH = pdoc.internal.pageSize.height
  pdoc.setFillColor(...DARK); pdoc.rect(0, pH-10, W, 10, 'F')
  pdoc.setTextColor(...WHITE); pdoc.setFontSize(7)
  pdoc.text('Corradi Mazzer — Controle de Façonagem', W/2, pH-3, { align: 'center' })

  pdoc.save(`inventario_${format(new Date(), 'yyyy-MM-dd')}.pdf`)
}

// ─────────────────────────────────────────────────────────────────
// RELATÓRIOS — PDF e XLSX
// ─────────────────────────────────────────────────────────────────

const DARK_R  = [15, 32, 60]
const MED_R   = [26, 80, 150]
const WHITE_R = [255, 255, 255]
const fmtN2 = n => Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})
const fmtDate2 = d => { try { return format(new Date(d),'dd/MM/yyyy') } catch { return '—' } }
const fmtDT2  = d => { try { return format(new Date(d),"dd/MM/yyyy HH:mm") } catch { return '—' } }

function pdfHeader(pdoc, titulo, subtitulo) {
  const W = pdoc.internal.pageSize.width
  pdoc.setFillColor(...DARK_R); pdoc.rect(0,0,W,28,'F')
  pdoc.setTextColor(...WHITE_R)
  pdoc.setFontSize(13); pdoc.setFont('helvetica','bold')
  pdoc.text('CORRADI MAZZER — FAÇONAGEM', W/2, 10, {align:'center'})
  pdoc.setFontSize(9); pdoc.setFont('helvetica','normal')
  pdoc.text(titulo.toUpperCase(), W/2, 18, {align:'center'})
  if (subtitulo) { pdoc.setFontSize(7); pdoc.text(subtitulo, W/2, 24, {align:'center'}) }
}

function pdfFooter(pdoc) {
  const total = pdoc.internal.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    pdoc.setPage(p)
    const W = pdoc.internal.pageSize.width
    const H = pdoc.internal.pageSize.height
    pdoc.setFillColor(...DARK_R); pdoc.rect(0,H-10,W,10,'F')
    pdoc.setTextColor(...WHITE_R); pdoc.setFontSize(7); pdoc.setFont('helvetica','normal')
    pdoc.text(`Corradi Mazzer — Controle de Façonagem  |  Pág. ${p}/${total}`, W/2, H-3, {align:'center'})
  }
}

// ── 1. Movimentações NF de Entrada ──────────────────────────────
export function relMovimentacoesNFPDF(nfs, alocacoes, filtro) {
  const pdoc = new jsPDF({orientation:'landscape', unit:'mm', format:'a4'})
  const W = pdoc.internal.pageSize.width
  const sub = filtro ? `Período: ${filtro}` : `Emitido: ${fmtDT2(new Date())}`
  pdfHeader(pdoc, 'Movimentações de NFs de Entrada', sub)

  autoTable(pdoc, {
    startY: 32, margin:{left:10,right:10},
    head: [['NF','Emissão','Cód. Material','Lote POY','Vol. Entrada (kg)','Saldo (kg)','Consumido (kg)','Romaneio','Tipo Saída','Abatido (kg)','Data Saída']],
    body: alocacoes.map(a => {
      const nf = nfs.find(n => n.id === a.nf_entrada_id) || {}
      const s  = a.saida || {}
      return [
        nf.numero_nf || '—', fmtDate2(nf.data_emissao), nf.codigo_material||'—', nf.lote||'—',
        fmtN2(nf.volume_kg), fmtN2(nf.volume_saldo_kg),
        fmtN2(Number(nf.volume_kg||0)-Number(nf.volume_saldo_kg||0)),
        s.romaneio_microdata||'—',
        TIPOS_SAIDA.find(t=>t.value===s.tipo_saida)?.label||s.tipo_saida||'—',
        fmtN2(a.volume_alocado_kg), fmtDT2(s.criado_em||a.criado_em),
      ]
    }),
    headStyles:{fillColor:MED_R,textColor:WHITE_R,fontSize:7,fontStyle:'bold'},
    bodyStyles:{fontSize:7},
    alternateRowStyles:{fillColor:[240,246,255]},
    columnStyles:{4:{halign:'right'},5:{halign:'right'},6:{halign:'right'},9:{halign:'right'}},
  })
  pdfFooter(pdoc)
  pdoc.save(`movimentacoes_nf_${format(new Date(),'yyyyMMdd')}.pdf`)
}

export function relMovimentacoesNFXLSX(nfs, alocacoes) {
  const wb = XLSX.utils.book_new()
  const rows = alocacoes.map(a => {
    const nf = nfs.find(n => n.id === a.nf_entrada_id) || {}
    const s  = a.saida || {}
    return {
      'NF': nf.numero_nf||'—', 'Emissão NF': fmtDate2(nf.data_emissao),
      'Cód. Material': nf.codigo_material||'—', 'Lote POY': nf.lote||'—',
      'Vol. Entrada (kg)': Number(nf.volume_kg||0),
      'Saldo Atual (kg)': Number(nf.volume_saldo_kg||0),
      'Consumido (kg)': Number(nf.volume_kg||0)-Number(nf.volume_saldo_kg||0),
      'Romaneio': s.romaneio_microdata||'—',
      'Tipo Saída': TIPOS_SAIDA.find(t=>t.value===s.tipo_saida)?.label||s.tipo_saida||'—',
      'Lote POY Saída': s.lote_poy||s.lote_produto||'—',
      'Abatido (kg)': Number(a.volume_alocado_kg||0),
      'Data Saída': fmtDT2(s.criado_em||a.criado_em),
    }
  })
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [12,12,14,12,16,14,14,14,22,12,14,16].map(w=>({wch:w}))
  XLSX.utils.book_append_sheet(wb, ws, 'Movimentações NF')
  XLSX.writeFile(wb, `movimentacoes_nf_${format(new Date(),'yyyyMMdd')}.xlsx`)
}

// ── 2. Faturamento ───────────────────────────────────────────────
export function relFaturamentoPDF(saidas, filtro) {
  const pdoc = new jsPDF({orientation:'landscape', unit:'mm', format:'a4'})
  const W = pdoc.internal.pageSize.width
  const fat = saidas.filter(s => s.tipo_saida === 'faturamento')
  const totalKg = fat.reduce((a,s) => a+Number(s.volume_abatido_kg||0),0)
  pdfHeader(pdoc, 'Movimentações de Faturamento', filtro ? `Período: ${filtro}` : `Emitido: ${fmtDT2(new Date())}`)

  autoTable(pdoc, {
    startY: 32, margin:{left:10,right:10},
    head: [['Romaneio','Cód. Material','Lote POY','Lote Acabado','Vol. Líq. (kg)','Vol. Final (kg)','NFs Abatidas','Data/Hora','Usuário']],
    body: fat.map(s => [
      s.romaneio_microdata, s.codigo_material||s.codigo_produto||'—',
      s.lote_poy||s.lote_produto||'—', s.lote_acabado||'—',
      fmtN2(s.volume_liquido_kg||s.volume_bruto_kg),
      fmtN2(s.volume_abatido_kg),
      (s.alocacao_saida||[]).map(a=>`NF ${a.numero_nf}: ${fmtN2(a.volume_alocado_kg)} kg`).join(' | '),
      fmtDT2(s.criado_em), s.usuario_email||'—',
    ]),
    foot: [['TOTAL','','','','', fmtN2(totalKg),'','','']],
    headStyles:{fillColor:MED_R,textColor:WHITE_R,fontSize:7,fontStyle:'bold'},
    bodyStyles:{fontSize:7},
    footStyles:{fillColor:DARK_R,textColor:WHITE_R,fontStyle:'bold'},
    alternateRowStyles:{fillColor:[240,246,255]},
    columnStyles:{4:{halign:'right'},5:{halign:'right'}},
  })
  pdfFooter(pdoc)
  pdoc.save(`faturamento_${format(new Date(),'yyyyMMdd')}.pdf`)
}

export function relFaturamentoXLSX(saidas) {
  const wb = XLSX.utils.book_new()
  const fat = saidas.filter(s => s.tipo_saida === 'faturamento')
  const rows = fat.map(s => ({
    'Romaneio': s.romaneio_microdata,
    'Cód. Material': s.codigo_material||s.codigo_produto||'—',
    'Lote POY': s.lote_poy||s.lote_produto||'—',
    'Lote Acabado': s.lote_acabado||'—',
    'Vol. Líquido (kg)': Number(s.volume_liquido_kg||s.volume_bruto_kg||0),
    'Vol. Final (kg)': Number(s.volume_abatido_kg||0),
    'Quantidade': s.quantidade||'',
    'NFs Abatidas': (s.alocacao_saida||[]).map(a=>`NF ${a.numero_nf}: ${fmtN2(a.volume_alocado_kg)} kg`).join(' | '),
    'Data/Hora': fmtDT2(s.criado_em),
    'Usuário': s.usuario_email||'—',
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [16,14,12,12,16,14,10,50,16,22].map(w=>({wch:w}))
  XLSX.utils.book_append_sheet(wb, ws, 'Faturamento')
  XLSX.writeFile(wb, `faturamento_${format(new Date(),'yyyyMMdd')}.xlsx`)
}

// ── 3. Devoluções ────────────────────────────────────────────────
const TIPOS_DEV = ['dev_qualidade','dev_processo','dev_final_campanha']

export function relDevolucoesPDF(saidas, filtro) {
  const pdoc = new jsPDF({orientation:'landscape', unit:'mm', format:'a4'})
  const W = pdoc.internal.pageSize.width
  const devs = saidas.filter(s => TIPOS_DEV.includes(s.tipo_saida))
  const totalKg = devs.reduce((a,s) => a+Number(s.volume_abatido_kg||0),0)
  pdfHeader(pdoc, 'Movimentações de Devoluções', filtro ? `Período: ${filtro}` : `Emitido: ${fmtDT2(new Date())}`)

  autoTable(pdoc, {
    startY: 32, margin:{left:10,right:10},
    head: [['Romaneio','Tipo Devolução','Cód. Material','Lote POY','Lote Acabado','Vol. Líq. (kg)','Vol. Final (kg)','NFs Abatidas','Data/Hora']],
    body: devs.map(s => [
      s.romaneio_microdata,
      TIPOS_SAIDA.find(t=>t.value===s.tipo_saida)?.label||s.tipo_saida,
      s.codigo_material||s.codigo_produto||'—',
      s.lote_poy||s.lote_produto||'—', s.lote_acabado||'—',
      fmtN2(s.volume_liquido_kg||s.volume_bruto_kg),
      fmtN2(s.volume_abatido_kg),
      (s.alocacao_saida||[]).map(a=>`NF ${a.numero_nf}: ${fmtN2(a.volume_alocado_kg)} kg`).join(' | '),
      fmtDT2(s.criado_em),
    ]),
    foot: [['TOTAL','','','','','', fmtN2(totalKg),'','']],
    headStyles:{fillColor:MED_R,textColor:WHITE_R,fontSize:7,fontStyle:'bold'},
    bodyStyles:{fontSize:7},
    footStyles:{fillColor:DARK_R,textColor:WHITE_R,fontStyle:'bold'},
    alternateRowStyles:{fillColor:[240,246,255]},
    columnStyles:{5:{halign:'right'},6:{halign:'right'}},
  })
  pdfFooter(pdoc)
  pdoc.save(`devolucoes_${format(new Date(),'yyyyMMdd')}.pdf`)
}

export function relDevolucoesXLSX(saidas) {
  const wb = XLSX.utils.book_new()
  const devs = saidas.filter(s => TIPOS_DEV.includes(s.tipo_saida))
  const rows = devs.map(s => ({
    'Romaneio': s.romaneio_microdata,
    'Tipo Devolução': TIPOS_SAIDA.find(t=>t.value===s.tipo_saida)?.label||s.tipo_saida,
    'Cód. Material': s.codigo_material||s.codigo_produto||'—',
    'Lote POY': s.lote_poy||s.lote_produto||'—',
    'Lote Acabado': s.lote_acabado||'—',
    'Vol. Líquido (kg)': Number(s.volume_liquido_kg||s.volume_bruto_kg||0),
    'Vol. Final (kg)': Number(s.volume_abatido_kg||0),
    'NFs Abatidas': (s.alocacao_saida||[]).map(a=>`NF ${a.numero_nf}: ${fmtN2(a.volume_alocado_kg)} kg`).join(' | '),
    'Data/Hora': fmtDT2(s.criado_em),
    'Usuário': s.usuario_email||'—',
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [16,24,14,12,12,16,14,50,16,22].map(w=>({wch:w}))
  XLSX.utils.book_append_sheet(wb, ws, 'Devoluções')
  XLSX.writeFile(wb, `devolucoes_${format(new Date(),'yyyyMMdd')}.xlsx`)
}

// ── 4. Inventário ────────────────────────────────────────────────
export function relInventarioPDF(inventarios, filtro) {
  const pdoc = new jsPDF({orientation:'landscape', unit:'mm', format:'a4'})
  const W = pdoc.internal.pageSize.width
  pdfHeader(pdoc, 'Relatório de Inventários', filtro ? `Período: ${filtro}` : `Emitido: ${fmtDT2(new Date())}`)

  let y = 32
  inventarios.forEach((inv, idx) => {
    if (idx > 0 && y > 160) { pdoc.addPage(); y = 15 }
    const linhas = inv.linhas || []
    const totalTeo = linhas.reduce((a,l)=>a+Number(l.saldo_teorico||0),0)
    const totalFis = linhas.reduce((a,l)=>a+Number(l.contagem_kg||0),0)

    // Cabeçalho do inventário
    pdoc.setFillColor(...MED_R); pdoc.setTextColor(...WHITE_R)
    pdoc.setFontSize(8); pdoc.setFont('helvetica','bold')
    pdoc.roundedRect(10, y, W-20, 7, 1, 1, 'F')
    pdoc.text(`Inventário: ${fmtDT2(inv.criado_em)}  |  ${linhas.length} lotes  |  Por: ${inv.criado_por||'—'}`, W/2, y+5, {align:'center'})
    y += 9

    autoTable(pdoc, {
      startY: y, margin:{left:10,right:10},
      head: [['Lote POY','Saldo Teórico (kg)','Contagem Física (kg)','Divergência (kg)','Divergência (%)','Status']],
      body: linhas.map(l => [
        l.lote,
        fmtN2(l.saldo_teorico), fmtN2(l.contagem_kg),
        (Number(l.divergencia_kg||0)>=0?'+':'')+fmtN2(l.divergencia_kg),
        (Number(l.divergencia_pct||0)>=0?'+':'')+Number(l.divergencia_pct||0).toFixed(2)+'%',
        Math.abs(Number(l.divergencia_pct||0))<0.5?'OK':Math.abs(Number(l.divergencia_pct||0))<2?'ATENÇÃO':'CRÍTICO',
      ]),
      foot: [['TOTAL', fmtN2(totalTeo), fmtN2(totalFis), fmtN2(totalFis-totalTeo), '', '']],
      headStyles:{fillColor:DARK_R,textColor:WHITE_R,fontSize:7,fontStyle:'bold'},
      bodyStyles:{fontSize:7},
      footStyles:{fillColor:DARK_R,textColor:WHITE_R,fontStyle:'bold'},
      alternateRowStyles:{fillColor:[240,246,255]},
      columnStyles:{1:{halign:'right'},2:{halign:'right'},3:{halign:'right'},4:{halign:'right'},5:{halign:'center'}},
      didParseCell(data) {
        if (data.section==='body'&&data.column.index===5) {
          const v = data.cell.raw
          if (v==='CRÍTICO') data.cell.styles.textColor=[200,30,30]
          else if (v==='ATENÇÃO') data.cell.styles.textColor=[180,120,0]
          else data.cell.styles.textColor=[0,140,70]
        }
      }
    })
    y = pdoc.lastAutoTable.finalY + 10
  })

  pdfFooter(pdoc)
  pdoc.save(`inventarios_${format(new Date(),'yyyyMMdd')}.pdf`)
}

export function relInventarioXLSX(inventarios) {
  const wb = XLSX.utils.book_new()
  inventarios.forEach((inv, idx) => {
    const linhas = inv.linhas || []
    const rows = linhas.map(l => ({
      'Lote POY': l.lote,
      'Saldo Teórico (kg)': Number(l.saldo_teorico||0),
      'Contagem Física (kg)': Number(l.contagem_kg||0),
      'Divergência (kg)': Number(l.divergencia_kg||0),
      'Divergência (%)': Number(l.divergencia_pct||0),
      'Status': Math.abs(Number(l.divergencia_pct||0))<0.5?'OK':Math.abs(Number(l.divergencia_pct||0))<2?'ATENÇÃO':'CRÍTICO',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [14,18,18,16,14,10].map(w=>({wch:w}))
    const nomePlanilha = `Inv ${fmtDate2(inv.criado_em)} (${idx+1})`
    XLSX.utils.book_append_sheet(wb, ws, nomePlanilha.substring(0,31))
  })
  XLSX.writeFile(wb, `inventarios_${format(new Date(),'yyyyMMdd')}.xlsx`)
}

// ── 5. Saldo Disponível NF Entrada ───────────────────────────────
export function relSaldoDisponivelNFPDF(nfs, filtro) {
  const pdoc = new jsPDF({orientation:'landscape', unit:'mm', format:'a4'})
  const W = pdoc.internal.pageSize.width
  const sub = filtro ? `Período: ${filtro}` : `Emitido: ${fmtDT2(new Date())}`
  pdfHeader(pdoc, 'Saldo Disponível NFs de Entrada', sub)

  autoTable(pdoc, {
    startY: 32, margin:{left:10,right:10},
    head: [['NF','Emissão','Cód. Material','Descrição','Lote POY','Saldo (kg)','V. Unitário (R$)','Valor Total (R$)']],
    body: nfs.map(nf => [
      nf.numero_nf || '—', fmtDate2(nf.data_emissao), nf.codigo_material||'—', nf.descricao_material||'—', nf.lote||'—',
      fmtN2(nf.volume_saldo_kg), fmtN2(nf.valor_unitario, 6), fmtN2(Number(nf.volume_saldo_kg||0) * Number(nf.valor_unitario||0), 2)
    ]),
    headStyles:{fillColor:MED_R,textColor:WHITE_R,fontSize:7,fontStyle:'bold'},
    bodyStyles:{fontSize:7},
    alternateRowStyles:{fillColor:[240,246,255]},
    columnStyles:{5:{halign:'right'},6:{halign:'right'},7:{halign:'right'}},
  })
  pdfFooter(pdoc)
  pdoc.save(`saldo_nfs_${format(new Date(),'yyyyMMdd')}.pdf`)
}

export function relSaldoDisponivelNFXLSX(nfs) {
  const wb = XLSX.utils.book_new()
  const rows = nfs.map(nf => ({
    'NF': nf.numero_nf||'—', 
    'Emissão NF': fmtDate2(nf.data_emissao),
    'Cód. Material': nf.codigo_material||'—', 
    'Descrição': nf.descricao_material||'—',
    'Lote POY': nf.lote||'—',
    'Saldo Atual (kg)': Number(nf.volume_saldo_kg||0),
    'V. Unitário (R$)': Number(nf.valor_unitario||0),
    'Valor Total (R$)': Number(nf.volume_saldo_kg||0) * Number(nf.valor_unitario||0),
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [12,12,14,30,12,14,14,14].map(w=>({wch:w}))
  XLSX.utils.book_append_sheet(wb, ws, 'Saldo NFs')
  XLSX.writeFile(wb, `saldo_nfs_${format(new Date(),'yyyyMMdd')}.xlsx`)
}
