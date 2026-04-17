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

// Material especial 135612: abatimento de 3,5% do volume líquido,
// distribuído entre materiais companion (óleo de encimagem)
export const MATERIAL_ESPECIAL_135612 = {
  codigo:               '135612',
  percentual_abatimento: 0.035,   // 3,5%
  distribuicao: [
    { codigo_material: '140911', percentual: 0.60 },  // 60% do abatimento
    { codigo_material: '140912', percentual: 0.40 },  // 40% do abatimento
  ],
}

export function getPercentualAbatimento(codigoMaterial) {
  if (codigoMaterial === MATERIAL_ESPECIAL_135612.codigo)
    return MATERIAL_ESPECIAL_135612.percentual_abatimento
  return PERCENTUAL_ABATIMENTO
}

export function calcularVolumeAbatido(volumeLiquido, tipoSaida, codigoMaterial) {
  if (!TIPOS_COM_ABATIMENTO.includes(tipoSaida)) return volumeLiquido
  if (codigoMaterial === MATERIAL_ESPECIAL_135612.codigo) {
    // Para 135612: volume abatido = líquido - abatimento (3,5%)
    // O abatimento vai para os companion, o principal debita o restante
    return volumeLiquido * (1 - MATERIAL_ESPECIAL_135612.percentual_abatimento)
  }
  return volumeLiquido * (1 - PERCENTUAL_ABATIMENTO)
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

export async function listarNFsEntrada(unidadeId = '') {
  const snap = await getDocs(query(collection(db, 'nf_entrada'), orderBy('data_emissao', 'asc')))
  const todos = snap.docs.map(docToObj)
  // Filtra por unidade se informada; docs sem unidade_id pertencem à raiz (sem unidade)
  if (!unidadeId) return todos
  return todos.filter(nf => (nf.unidade_id || '') === unidadeId)
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
    unidade_id:      payload.unidade_id || '',
    criado_em:       now,
    atualizado_em:   now,
  })
  await registrarLog('NF_ENTRADA_CRIADA', `NF ${payload.numero_nf} — ${payload.volume_kg} kg`, usuario)
  const snap = await getDoc(docRef)
  return docToObj(snap)
}

export async function editarNFEntrada(id, payload, usuario) {
  const now = Timestamp.now()
  const snapAtual = await getDoc(doc(db, 'nf_entrada', id))
  if (!snapAtual.exists()) throw new Error('NF não encontrada.')
  const atual = snapAtual.data()
  const consumido = Number(atual.volume_kg) - Number(atual.volume_saldo_kg)
  const novoSaldo = Math.max(0, payload.volume_kg - consumido)

  const dadosAntes = {
    numero_nf: atual.numero_nf, data_emissao: tsToISO(atual.data_emissao),
    codigo_material: atual.codigo_material, lote: atual.lote,
    volume_kg: atual.volume_kg, valor_unitario: atual.valor_unitario,
  }
  const dadosDepois = {
    numero_nf: payload.numero_nf, data_emissao: payload.data_emissao,
    codigo_material: payload.codigo_material, lote: payload.lote,
    volume_kg: payload.volume_kg, valor_unitario: payload.valor_unitario,
  }

  await updateDoc(doc(db, 'nf_entrada', id), {
    numero_nf:       payload.numero_nf,
    data_emissao:    Timestamp.fromDate(new Date(payload.data_emissao + 'T12:00:00')),
    codigo_material: payload.codigo_material,
    lote:            payload.lote,
    volume_kg:       payload.volume_kg,
    volume_saldo_kg: novoSaldo,
    valor_unitario:  payload.valor_unitario,
    unidade_id:      payload.unidade_id || '',
    atualizado_em:   now,
  })

  // Registra histórico de edição
  await addDoc(collection(db, 'nf_historico'), {
    nf_id: id,
    dados_antes: dadosAntes,
    dados_depois: dadosDepois,
    usuario_email: usuario?.email || '',
    editado_em: now,
  })
  await registrarLog('NF_ENTRADA_EDITADA', `NF ${payload.numero_nf} atualizada`, usuario)
}

export async function deletarNFEntrada(id, numeroNF, usuario) {
  await deleteDoc(doc(db, 'nf_entrada', id))
  await registrarLog('NF_ENTRADA_REMOVIDA', `NF ${numeroNF} removida`, usuario)
}

export async function buscarAlocacoesPorNF(nfId) {
  // Sem orderBy para evitar necessidade de índice composto no Firestore
  const alocSnap = await getDocs(
    query(collection(db, 'alocacao_saida'), where('nf_entrada_id', '==', nfId))
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

// Extrai texto do PDF usando pdfjs-dist (roda no browser, sem CORS)
async function extrairTextoPDF(base64Data) {
  // Importação dinâmica para não aumentar o bundle inicial
  const pdfjsLib = await import('pdfjs-dist')
  // Worker inline via CDN — evita problema de configuração do Vite
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

  const raw      = atob(base64Data)
  const uint8    = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) uint8[i] = raw.charCodeAt(i)

  const pdf   = await pdfjsLib.getDocument({ data: uint8 }).promise
  let   texto = ''
  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p)
    const content = await page.getTextContent()
    texto += content.items.map(i => i.str).join(' ') + '\n'
  }
  return texto
}

// Envia texto ao proxy Vercel → OpenRouter — agora retorna { numero_nf, data_emissao, itens: [...] }
export async function extrairDadosNFdoPDF(base64Data) {
  const pdfText = await extrairTextoPDF(base64Data)

  const response = await fetch('/api/extract-nf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdfText })
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
      lote: dados.lote ? String(dados.lote).replace(/\D/g,'').substring(0,4) : '',
      volume_kg: dados.volume_kg || 0,
      valor_unitario: dados.valor_unitario || 0,
    }]
  }
  dados.itens = dados.itens.map(item => ({
    ...item,
    lote: item.lote ? String(item.lote).replace(/\D/g,'').substring(0,4) : '',
  }))

  return dados
}

// Cria múltiplas NFs de uma vez (NF com vários itens)
export async function criarNFsEntradaLote(itens, usuario) {
  // itens: [{ numero_nf, data_emissao, codigo_material, lote, volume_kg, valor_unitario, unidade_id }]
  const resultados = []
  for (const item of itens) {
    const res = await criarNFEntrada(item, usuario)
    resultados.push(res)
  }
  return resultados
}

// ─────────────────────────────────────────────────────────────────
// PREVIEW FIFO (sem gravar — usado para confirmação)
// ─────────────────────────────────────────────────────────────────

export async function previewFIFO(volumeAbatido, { codigoMaterial, lotePoy, unidadeId = '', volumeLiquido = null } = {}) {
  const snap = await getDocs(query(collection(db, 'nf_entrada'), orderBy('data_emissao', 'asc')))
  const allNFs = snap.docs.map(docToObj)

  const filtrarNFs = (codMat, lote) => allNFs.filter(nf => {
    if (Number(nf.volume_saldo_kg) <= 0.001) return false
    if (unidadeId && (nf.unidade_id || '') !== unidadeId) return false
    if (codMat && nf.codigo_material !== codMat) return false
    if (lote) {
      const loteNF    = String(nf.lote || '').substring(0, 4)
      const loteSaida = String(lote).substring(0, 4)
      if (loteNF !== loteSaida) return false
    }
    return true
  })

  const buildPreview = (nfsList, vol) => {
    let restante = vol
    const preview = []
    for (const nf of nfsList) {
      if (restante <= 0) break
      const alocar = Math.min(Number(nf.volume_saldo_kg), restante)
      preview.push({ numero_nf: nf.numero_nf, data_emissao: nf.data_emissao, saldo_atual: nf.volume_saldo_kg, volume_alocado_kg: alocar })
      restante -= alocar
    }
    return { preview, saldoInsuficiente: restante > 0.01, faltando: restante }
  }

  const nfsFiltradas = filtrarNFs(codigoMaterial, lotePoy)
  const resultado = buildPreview(nfsFiltradas, volumeAbatido)

  // Regra especial 135612: o abatimento (3,5% do volume líquido) é debitado de NFs de materiais companion
  if (codigoMaterial === MATERIAL_ESPECIAL_135612.codigo) {
    const volLiq = volumeLiquido != null ? volumeLiquido : volumeAbatido / (1 - MATERIAL_ESPECIAL_135612.percentual_abatimento)
<<<<<<< HEAD
    const volumeAbatimento = volumeAbatimentoOverride != null
      ? volumeAbatimentoOverride
      : volLiq * MATERIAL_ESPECIAL_135612.percentual_abatimento
=======
    const volumeAbatimento = volLiq * MATERIAL_ESPECIAL_135612.percentual_abatimento
>>>>>>> parent of 0aefc03 (V36)
    resultado.previewsCompanion = MATERIAL_ESPECIAL_135612.distribuicao.map(dist => {
      const volDist = volumeAbatimento * dist.percentual
      const { preview, saldoInsuficiente, faltando } = buildPreview(filtrarNFs(dist.codigo_material, null), volDist)
      return { ...dist, volume: volDist, preview, saldoInsuficiente, faltando }
    })
  }

  return resultado
}

// ─────────────────────────────────────────────────────────────────
// SAÍDA COM ALOCAÇÃO FIFO
// ─────────────────────────────────────────────────────────────────

export async function criarSaida(payload, usuario) {
  const {
    romaneio_microdata, codigo_material, lote_poy, lote_acabado,
    tipo_saida, volume_liquido_kg, volume_bruto_kg, quantidade,
    unidade_id = ''
  } = payload

  const temAbatimento         = TIPOS_COM_ABATIMENTO.includes(tipo_saida)
  const isEspecial135612      = codigo_material === MATERIAL_ESPECIAL_135612.codigo
  const volume_abatido_kg     = calcularVolumeAbatido(volume_liquido_kg, tipo_saida, codigo_material)
  const percentual_abatimento = temAbatimento ? getPercentualAbatimento(codigo_material) : 0
  const volume_abatimento_kg  = temAbatimento && isEspecial135612 ? volume_liquido_kg * MATERIAL_ESPECIAL_135612.percentual_abatimento : 0

  const snap = await getDocs(query(collection(db, 'nf_entrada'), orderBy('data_emissao', 'asc')))
  const allNFs = snap.docs.map(docToObj)

  const filtrarNFsPorMat = (codMat, lote) => allNFs.filter(nf => {
    if (Number(nf.volume_saldo_kg) <= 0.001) return false
    if (unidade_id && (nf.unidade_id || '') !== unidade_id) return false
    if (codMat && nf.codigo_material !== codMat) return false
    if (lote) {
      const loteNF    = String(nf.lote || '').substring(0, 4)
      const loteSaida = String(lote).substring(0, 4)
      if (loteNF !== loteSaida) return false
    }
    return true
  })

  const nfsComSaldo = filtrarNFsPorMat(codigo_material, lote_poy)

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

  // Alocações companion (material 135612) — debita dos materiais auxiliares
  const alocacoesCompanion = []
  if (isEspecial135612 && temAbatimento && volume_abatimento_kg > 0) {
    for (const dist of MATERIAL_ESPECIAL_135612.distribuicao) {
      const volDist = volume_abatimento_kg * dist.percentual
      const nfsComp = filtrarNFsPorMat(dist.codigo_material, null)
      let restComp = volDist
      for (const nf of nfsComp) {
        if (restComp <= 0) break
        const alocar = Math.min(Number(nf.volume_saldo_kg), restComp)
        alocacoesCompanion.push({
          nf_entrada_id: nf.id, numero_nf: nf.numero_nf, data_emissao: nf.data_emissao,
          volume_alocado_kg: alocar, codigo_material_companion: dist.codigo_material
        })
        restComp -= alocar
      }
    }
  }

  const now      = Timestamp.now()
  const batch    = writeBatch(db)
  const saidaRef = doc(collection(db, 'saida'))

  batch.set(saidaRef, {
    romaneio_microdata,
    codigo_material,
    codigo_produto: codigo_material,
    lote_poy,
    lote_acabado:         lote_acabado || '',
    tipo_saida,
    volume_liquido_kg,
    volume_bruto_kg:      volume_bruto_kg || null,
    quantidade:           quantidade || null,
    volume_abatido_kg,
    percentual_abatimento,
<<<<<<< HEAD
    volume_abatimento_kg: volume_abatimento_kg || null,
=======
>>>>>>> parent of 0aefc03 (V36)
    unidade_id,
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

  // Persiste alocações companion e atualiza saldos
  const alocacoesCompanionRetorno = []
  for (const aloc of alocacoesCompanion) {
    const alocRef  = doc(collection(db, 'alocacao_saida'))
    const alocData = {
      saida_id: saidaRef.id, nf_entrada_id: aloc.nf_entrada_id,
      numero_nf: aloc.numero_nf, data_emissao: aloc.data_emissao,
      volume_alocado_kg: aloc.volume_alocado_kg,
      codigo_material_companion: aloc.codigo_material_companion,
      criado_em: now
    }
    batch.set(alocRef, alocData)
    alocacoesCompanionRetorno.push({ id: alocRef.id, ...alocData })
    const nfComp = allNFs.find(n => n.id === aloc.nf_entrada_id)
    if (nfComp) {
      const novoSaldo = Number(nfComp.volume_saldo_kg) - aloc.volume_alocado_kg
      batch.update(doc(db, 'nf_entrada', aloc.nf_entrada_id), { volume_saldo_kg: novoSaldo, atualizado_em: now })
    }
  }

  await batch.commit()
  await registrarLog(
    'SAIDA_REGISTRADA',
    `Romaneio ${romaneio_microdata} — ${volume_abatido_kg.toFixed(4)} kg (${TIPOS_SAIDA.find(t=>t.value===tipo_saida)?.label}) | ${codigo_material} / Lote ${lote_poy}`,
    usuario
  )

  return {
    saida: {
      id: saidaRef.id, romaneio_microdata, codigo_material, lote_poy, lote_acabado,
      tipo_saida, volume_liquido_kg, volume_bruto_kg, quantidade,
      volume_abatido_kg, percentual_abatimento, unidade_id,
      criado_em: now.toDate().toISOString()
    },
    alocacoes: alocacoesRetorno,
    alocacoesCompanion: alocacoesCompanionRetorno,
  }
}

export async function listarSaidas(unidadeId = '') {
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
export async function deletarSaida(saidaId, usuario) {
  // Busca alocações desta saída para estornar
  const alocSnap = await getDocs(
    query(collection(db, 'alocacao_saida'), where('saida_id', '==', saidaId))
  )
  const saidaSnap = await getDoc(doc(db, 'saida', saidaId))
  if (!saidaSnap.exists()) throw new Error('Saída não encontrada.')
  const saida = saidaSnap.data()

  const batch = writeBatch(db)
  const now   = Timestamp.now()

  // Estorna saldo em cada NF alocada
  for (const alocDoc of alocSnap.docs) {
    const aloc   = alocDoc.data()
    const nfSnap = await getDoc(doc(db, 'nf_entrada', aloc.nf_entrada_id))
    if (nfSnap.exists()) {
      const saldoAtual  = Number(nfSnap.data().volume_saldo_kg || 0)
      const novoSaldo   = saldoAtual + Number(aloc.volume_alocado_kg)
      batch.update(doc(db, 'nf_entrada', aloc.nf_entrada_id), { volume_saldo_kg: novoSaldo, atualizado_em: now })
    }
    batch.delete(doc(db, 'alocacao_saida', alocDoc.id))
  }

  batch.delete(doc(db, 'saida', saidaId))
  await batch.commit()
  await registrarLog('SAIDA_EXCLUIDA', `Romaneio ${saida.romaneio_microdata} excluído — saldo estornado`, usuario)
}

// Verifica se número de NF já existe em qualquer unidade
export async function verificarNFDuplicada(numeroNF) {
  const snap = await getDocs(query(collection(db, 'nf_entrada'), where('numero_nf', '==', String(numeroNF).trim())))
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

function _buildRomaneioPDF(saida, alocacoes, config = {}) {
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
  pdoc.text('CORRADI MAZZER FAÇONAGEM', W / 2, 13, { align: 'center' })
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
  y += 7
  linha('Romaneio Microdata',    saida.romaneio_microdata,  col1, y)
  linha('Código do Material',    codigoMaterial,            col2, y)
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

  if (temAbat) {
    pdoc.setFont('helvetica', 'bold'); pdoc.setFontSize(9); pdoc.setTextColor(...DARK)
    pdoc.text('Volume a Debitar do Estoque (com abat. 1,5%):', col1, y)
    pdoc.setTextColor(...MED)
    pdoc.text(fmtKg(saida.volume_abatido_kg), col1 + 88, y)
    y += 12
  } else {
    pdoc.setFont('helvetica', 'bold'); pdoc.setFontSize(9); pdoc.setTextColor(...DARK)
    pdoc.text('Volume a Debitar do Estoque:', col1, y)
    pdoc.setTextColor(...MED)
    pdoc.text(fmtKg(saida.volume_abatido_kg), col1 + 60, y)
    y += 8
  }

  y += 6

  // ── Tabela FIFO ────────────────────────────────────────
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
  pdoc.text('Corradi Mazzer — Controle de Façonagem', W / 2, pH - 4, { align: 'center' })

  return pdoc
}

export function gerarRomaneioPDF(saida, alocacoes, config = {}) {
  const pdoc = _buildRomaneioPDF(saida, alocacoes, config)
  pdoc.save(`romaneio_${saida.romaneio_microdata}_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`)
}

export function gerarRomaneioBase64(saida, alocacoes, config = {}) {
  const pdoc = _buildRomaneioPDF(saida, alocacoes, config)
  return pdoc.output('datauristring').split(',')[1] // retorna base64 puro
}



// ─────────────────────────────────────────────────────────────────
// HISTÓRICO DE EDIÇÕES DE NF
// ─────────────────────────────────────────────────────────────────

export async function registrarEdicaoNF(nfId, dadosAntes, dadosDepois, usuario) {
  await addDoc(collection(db, 'nf_historico'), {
    nf_id: nfId,
    dados_antes: dadosAntes,
    dados_depois: dadosDepois,
    usuario_email: usuario?.email || '',
    editado_em: Timestamp.now(),
  })
}

export async function listarHistoricoNF(nfId) {
  const snap = await getDocs(
    query(collection(db, 'nf_historico'), where('nf_id', '==', nfId))
  )
  return snap.docs
    .map(d => ({ id: d.id, ...d.data(), editado_em: tsToDateTime(d.data().editado_em) }))
    .sort((a, b) => (b.editado_em || '').localeCompare(a.editado_em || ''))
}

// ─────────────────────────────────────────────────────────────────
// SAÍDA EM LOTE (múltiplos romaneios de uma vez)
// ─────────────────────────────────────────────────────────────────

export async function criarSaidasEmLote(saidas, usuario) {
  const resultados = []
  for (const saida of saidas) {
    const result = await criarSaida(saida, usuario)
    resultados.push(result)
  }
  await registrarLog('SAIDA_LOTE', `${saidas.length} saídas registradas em lote`, usuario)
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
  pdoc.text('CORRADI MAZZER FAÇONAGEM', W/2, 12, { align: 'center' })
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
export async function salvarInventario(unidadeId, linhas, usuario) {
  const now = Timestamp.now()
  const ref = await addDoc(collection(db, 'inventario'), {
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
    usuario
  )
  return ref.id
}

// Lista inventários históricos da unidade
export async function listarInventarios(unidadeId) {
  const snap = await getDocs(
    query(collection(db, 'inventario'), orderBy('criado_em', 'desc'))
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
  pdoc.text('CORRADI MAZZER FAÇONAGEM — INVENTÁRIO FÍSICO', W/2, 11, { align: 'center' })
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
  pdoc.text('CORRADI MAZZER FAÇONAGEM', W/2, 10, {align:'center'})
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
