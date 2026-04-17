import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  listarSaidas, criarSaida, deletarSaida, listarNFsEntrada, previewFIFO,
  TIPOS_SAIDA, TIPOS_COM_ABATIMENTO,
  calcularVolumeAbatido, gerarRomaneioPDF, gerarRomaneioBase64, exportarExcel, carregarConfig,
  MATERIAL_ESPECIAL_135612, getPercentualAbatimento,
} from '../lib/faconagem'
import { useAuth } from '../lib/AuthContext'
import { useUser } from '../lib/UserContext'
import { format } from 'date-fns'

// ── Fila offline (localStorage) ──────────────────────────────────
const OFFLINE_KEY = 'faconagem_offline_queue'
function getQueue()       { try { return JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]') } catch { return [] } }
function saveQueue(q)     { localStorage.setItem(OFFLINE_KEY, JSON.stringify(q)) }
function addToQueue(item) { const q = getQueue(); q.push({ ...item, _id: Date.now() }); saveQueue(q) }
function removeFromQueue(id) { saveQueue(getQueue().filter(i => i._id !== id)) }

function Toast({ toasts }) {
  return <div className="toast-container">{toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
}

const EMPTY_FORM = {
  romaneio_microdata: '',
  codigo_material: '',   // renomeado de codigo_produto
  lote_poy: '',
  lote_acabado: '',
  tipo_saida: '',
  volume_liquido_kg: '',
  volume_bruto_kg: '',
  quantidade: '',
}

function tipoBadge(tipo) {
  const map = { faturamento:'badge-blue', sucata:'badge-danger', estopa:'badge-warn', dev_qualidade:'badge-green', dev_processo:'badge-green', dev_final_campanha:'badge-green' }
  const label = TIPOS_SAIDA.find(t => t.value === tipo)?.label || tipo
  return <span className={`badge ${map[tipo] || 'badge-blue'}`}>{label}</span>
}

const fmt = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── Modal de Confirmação FIFO ─────────────────────────────────────────────
function ConfirmacaoModal({ form, preview, onConfirm, onCancel, loading }) {
  const volumeLiq  = parseFloat(form.volume_liquido_kg) || 0
  const temAbat    = TIPOS_COM_ABATIMENTO.includes(form.tipo_saida)
  const volumeFinal = calcularVolumeAbatido(volumeLiq, form.tipo_saida)
  const tipoLbl    = TIPOS_SAIDA.find(t => t.value === form.tipo_saida)?.label || ''

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{maxWidth:580}} onClick={e => e.stopPropagation()}>
        <div className="modal-title">⚡ Confirmar Saída</div>

        <div className="abatimento-box" style={{marginBottom:16}}>
          <div className="abatimento-row">
            <span className="abatimento-label">Romaneio Microdata</span>
            <span className="abatimento-value">{form.romaneio_microdata}</span>
          </div>
          <div className="abatimento-row">
            <span className="abatimento-label">Lote POY</span>
            <span className="abatimento-value">{form.lote_poy}</span>
          </div>
          {form.lote_acabado && (
            <div className="abatimento-row">
              <span className="abatimento-label">Lote Acabado</span>
              <span className="abatimento-value">{form.lote_acabado}</span>
            </div>
          )}
          {form.quantidade && (
            <div className="abatimento-row">
              <span className="abatimento-label">Quantidade</span>
              <span className="abatimento-value">{form.quantidade}</span>
            </div>
          )}
          <div className="abatimento-row">
            <span className="abatimento-label">Tipo</span>
            <span>{tipoBadge(form.tipo_saida)}</span>
          </div>
          <div className="abatimento-row">
            <span className="abatimento-label">Volume Líquido</span>
            <span className="abatimento-value">{fmt(volumeLiq)} kg</span>
          </div>
          {form.volume_bruto_kg && (
            <div className="abatimento-row">
              <span className="abatimento-label">Volume Bruto</span>
              <span className="abatimento-value">{fmt(parseFloat(form.volume_bruto_kg))} kg</span>
            </div>
          )}
          {temAbat && (
            <div className="abatimento-row">
              <span className="abatimento-label">Abatimento 1,5% ({tipoLbl})</span>
              <span className="abatimento-value" style={{color:'var(--warn)'}}>− {fmt(volumeLiq - volumeFinal)} kg</span>
            </div>
          )}
          <div style={{borderTop:'1px solid var(--border)', paddingTop:8, marginTop:4}}>
            <div className="abatimento-row">
              <span className="abatimento-label" style={{fontWeight:700}}>Volume a Debitar do Estoque</span>
              <span className="abatimento-value highlight">{fmt(volumeFinal)} kg</span>
            </div>
          </div>
        </div>

        <div style={{fontSize:12, fontWeight:600, color:'var(--blue-200)', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.04em'}}>
          Débito nas NFs de Entrada (FIFO):
        </div>

        <div className="table-wrap" style={{marginBottom:4}}>
          <table>
            <thead>
              <tr>
                <th>NF</th>
                <th>Emissão</th>
                <th className="td-right">Saldo Atual</th>
                <th className="td-right">Será Debitado</th>
                <th className="td-right">Saldo Restante</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((p, i) => (
                <tr key={i}>
                  <td className="td-mono" style={{fontWeight:600}}>{p.numero_nf}</td>
                  <td style={{fontSize:12}}>{p.data_emissao ? format(new Date(p.data_emissao), 'dd/MM/yyyy') : '—'}</td>
                  <td className="td-right td-mono">{fmt(p.saldo_atual)}</td>
                  <td className="td-right td-mono" style={{color:'var(--warn)', fontWeight:600}}>− {fmt(p.volume_alocado_kg)}</td>
                  <td className="td-right td-mono" style={{color: (p.saldo_atual - p.volume_alocado_kg) <= 0.01 ? 'var(--danger)' : 'var(--accent-2)'}}>
                    {fmt(Math.max(0, p.saldo_atual - p.volume_alocado_kg))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={loading}>Cancelar</button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={loading}>
            {loading ? 'Processando...' : '✓ Confirmar e Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal de Sucesso ───────────────────────────────────────────────────────
function SucessoModal({ ultimaSaida, onClose, onPDF }) {
  const s = ultimaSaida.saida
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth:520}} onClick={e => e.stopPropagation()}>
        <div className="modal-title" style={{color:'var(--accent-2)'}}>✓ Saída Registrada!</div>

        <div className="abatimento-box" style={{marginBottom:16}}>
          <div className="abatimento-row">
            <span className="abatimento-label">Romaneio Microdata</span>
            <span className="abatimento-value">{s.romaneio_microdata}</span>
          </div>
          <div className="abatimento-row">
            <span className="abatimento-label">Tipo</span>
            <span>{tipoBadge(s.tipo_saida)}</span>
          </div>
          <div className="abatimento-row">
            <span className="abatimento-label">Volume Líquido</span>
            <span className="abatimento-value">{fmt(s.volume_liquido_kg)} kg</span>
          </div>
          {s.volume_bruto_kg && (
            <div className="abatimento-row">
              <span className="abatimento-label">Volume Bruto</span>
              <span className="abatimento-value">{fmt(s.volume_bruto_kg)} kg</span>
            </div>
          )}
          {s.quantidade && (
            <div className="abatimento-row">
              <span className="abatimento-label">Quantidade</span>
              <span className="abatimento-value">{s.quantidade}</span>
            </div>
          )}
          <div className="abatimento-row">
            <span className="abatimento-label">Volume Debitado do Estoque</span>
            <span className="abatimento-value highlight">{fmt(s.volume_abatido_kg)} kg</span>
          </div>
        </div>

        <div style={{fontSize:12, fontWeight:600, color:'var(--blue-200)', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.04em'}}>
          Alocações FIFO
        </div>
        <div className="table-wrap" style={{marginBottom:16}}>
          <table>
            <thead><tr><th>NF</th><th>Emissão</th><th className="td-right">Abatido (kg)</th></tr></thead>
            <tbody>
              {ultimaSaida.alocacoes.map((a, i) => (
                <tr key={i}>
                  <td className="td-mono">{a.numero_nf}</td>
                  <td>{a.data_emissao ? format(new Date(a.data_emissao), 'dd/MM/yyyy') : '—'}</td>
                  <td className="td-right td-mono">{fmt(a.volume_alocado_kg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Fechar</button>
          <button className="btn btn-success" onClick={onPDF}>📄 Gerar PDF</button>
        </div>
      </div>
    </div>
  )
}

// ── Página Principal ──────────────────────────────────────────────────────
export default function SaidaPage() {
  const { user } = useAuth()
  const { unidadeAtiva, isSupervisor } = useUser() || {}
  const [saidas, setSaidas]           = useState([])
  const [nfs, setNfs]                 = useState([])
  const [form, setForm]               = useState(EMPTY_FORM)
  const [loading, setLoading]         = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [toasts, setToasts]           = useState([])
  const [ultimaSaida, setUltimaSaida] = useState(null)
  const [confirmacao, setConfirmacao] = useState(null)
  const [config, setConfig]           = useState({})
  const [confirmDeleteSaida, setConfirmDeleteSaida] = useState(null)
  const [emailLoading, setEmailLoading] = useState(false)

  // Offline
  const [isOnline, setIsOnline]       = useState(navigator.onLine)
  const [offlineQueue, setOfflineQueue] = useState(getQueue())
  const [sincronizando, setSincronizando] = useState(false)

  // Modo lote — nova implementação
  const [aba, setAba]                     = useState('simples') // 'simples' | 'lote'
  const [loteForm, setLoteForm]           = useState({ tipo_saida: '', lote_poy: '', codigo_material: '', lote_acabado: '' })
  const [loteLinhas, setLoteLinhas]       = useState([]) // [{nf, romaneio, volume_liquido_kg, incluir}]
  const [loteLoading, setLoteLoading]     = useState(false)
  const [loteResultados, setLoteResultados] = useState([]) // romaneios gerados

  // Lotes únicos disponíveis nas NFs com saldo
  const lotesDisponiveis = useMemo(() => {
    const s = new Set(nfs.filter(n => Number(n.volume_saldo_kg) > 0.01).map(n => n.lote || ''))
    return [...s].filter(Boolean).sort()
  }, [nfs])

  // Carrega NFs do lote selecionado
  useEffect(() => {
    if (!loteForm.lote_poy) { setLoteLinhas([]); return }
    const nfsDolote = nfs.filter(n => {
      const loteNF = String(n.lote || '').substring(0, 4)
      const loteSel = String(loteForm.lote_poy).substring(0, 4)
      if (loteNF !== loteSel) return false
      if (loteForm.codigo_material && n.codigo_material !== loteForm.codigo_material) return false
      return Number(n.volume_saldo_kg) > 0.01
    })
    setLoteLinhas(nfsDolote.map(nf => ({
      nf,
      romaneio: '',
      volume_liquido_kg: '',
      incluir: true,
    })))
  }, [loteForm.lote_poy, loteForm.codigo_material, nfs])

  const setLinha = (idx, campo, valor) => {
    setLoteLinhas(ls => ls.map((l, i) => i === idx ? { ...l, [campo]: valor } : l))
  }

  const handleGerarLote = async () => {
    const linhasAtivas = loteLinhas.filter(l => l.incluir && Number(l.volume_liquido_kg) > 0)
    if (!loteForm.tipo_saida) { toast('Selecione o tipo de saída.', 'error'); return }
    if (linhasAtivas.length === 0) { toast('Nenhuma linha com volume preenchido.', 'error'); return }
    const semRomaneio = linhasAtivas.filter(l => !l.romaneio.trim())
    if (semRomaneio.length > 0) { toast('Preencha o número do romaneio em todas as linhas incluídas.', 'error'); return }

    setLoteLoading(true)
    const resultados = []
    const erros = []

    for (const linha of linhasAtivas) {
      const volLiq = parseFloat(linha.volume_liquido_kg)
      const payload = {
        romaneio_microdata: linha.romaneio.trim(),
        codigo_material:    linha.nf.codigo_material || '',
        lote_poy:           loteForm.lote_poy,
        lote_acabado:       loteForm.lote_acabado.trim() || '',
        tipo_saida:         loteForm.tipo_saida,
        volume_liquido_kg:  volLiq,
        volume_bruto_kg:    null,
        quantidade:         null,
        unidade_id:         unidadeAtiva || '',
      }
      try {
        const res = await criarSaida(payload, user)
        resultados.push({ romaneio: linha.romaneio, nf: linha.nf.numero_nf, volLiq, res })
      } catch (e) {
        erros.push({ romaneio: linha.romaneio, erro: e.message })
      }
    }

    setLoteLoading(false)
    setLoteResultados(resultados)
    if (resultados.length > 0) {
      toast(`✅ ${resultados.length} romaneio(s) gerado(s) com sucesso!`)
      load()
    }
    if (erros.length > 0) {
      toast(`⚠️ ${erros.length} erro(s): ${erros.map(e => e.romaneio).join(', ')}`, 'error')
    }
  }

  const resetLote = () => {
    setLoteForm({ tipo_saida: '', lote_poy: '', codigo_material: '', lote_acabado: '' })
    setLoteLinhas([])
    setLoteResultados([])
  }

  // Filtros
  const [fBusca, setFBusca] = useState('')
  const [fTipo, setFTipo]   = useState('')
  const [fDe, setFDe]       = useState('')
  const [fAte, setFAte]     = useState('')

  const toast = (msg, type = 'success') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }

  const load = () => {
    setLoadingList(true)
    Promise.all([listarSaidas(unidadeAtiva || ''), listarNFsEntrada(unidadeAtiva || '')])
      .then(([s, n]) => { setSaidas(s); setNfs(n) })
      .catch(e => toast(e.message, 'error'))
      .finally(() => setLoadingList(false))
  }

  useEffect(() => { load(); carregarConfig().then(setConfig) }, [unidadeAtiva])

  // Monitor online/offline
  useEffect(() => {
    const on  = () => { setIsOnline(true);  setOfflineQueue(getQueue()) }
    const off = () => setIsOnline(false)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Sincroniza fila offline automaticamente ao voltar online
  useEffect(() => {
    if (isOnline && getQueue().length > 0) sincronizarFila()
  }, [isOnline])

  async function sincronizarFila() {
    const fila = getQueue()
    if (!fila.length || sincronizando) return
    setSincronizando(true)
    let ok = 0, erros = 0
    for (const item of fila) {
      try {
        await criarSaida(item.payload, item.usuario)
        removeFromQueue(item._id)
        ok++
      } catch { erros++ }
    }
    setOfflineQueue(getQueue())
    setSincronizando(false)
    if (ok > 0) { toast(`✅ ${ok} saída(s) sincronizada(s) com sucesso!`); load() }
    if (erros > 0) toast(`⚠️ ${erros} saída(s) com erro na sincronização.`, 'error')
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Cálculos do formulário
  const volumeLiq     = parseFloat(form.volume_liquido_kg) || 0
  const temAbatimento = TIPOS_COM_ABATIMENTO.includes(form.tipo_saida)
  const volumeAbatido = calcularVolumeAbatido(volumeLiq, form.tipo_saida)

  // Saldo disponível filtrado por código do material + lote POY da unidade ativa
  const nfsFiltradas = useMemo(() => {
    return nfs.filter(nf => {
      if (form.codigo_material && nf.codigo_material !== form.codigo_material) return false
      if (form.lote_poy) {
        const loteNF    = String(nf.lote || '').substring(0, 4)
        const loteSaida = String(form.lote_poy).substring(0, 4)
        if (loteNF !== loteSaida) return false
      }
      return true
    })
  }, [nfs, form.codigo_material, form.lote_poy])

  const totalSaldo       = nfsFiltradas.reduce((a, n) => a + Number(n.volume_saldo_kg), 0)
  const saldoInsuficiente = volumeAbatido > totalSaldo + 0.01

  const handlePreConfirm = async () => {
    if (!form.romaneio_microdata || !form.codigo_material || !form.lote_poy || !form.tipo_saida || !form.volume_liquido_kg) {
      toast('Preencha os campos obrigatórios (*).', 'error'); return
    }
    if (nfsFiltradas.length === 0) {
      toast(`Nenhuma NF encontrada para o material "${form.codigo_material}" / lote "${form.lote_poy}" nesta unidade.`, 'error'); return
    }
    if (saldoInsuficiente) {
      toast(`Saldo insuficiente! Disponível para este material/lote: ${fmt(totalSaldo)} kg`, 'error'); return
    }
    const { preview } = await previewFIFO(volumeAbatido, {
      codigoMaterial: form.codigo_material,
      lotePoy:        form.lote_poy,
      unidadeId:      unidadeAtiva || '',
    })
    setConfirmacao({ preview })
  }

  const handleConfirmar = async () => {
    const payload = {
      romaneio_microdata: form.romaneio_microdata.trim(),
      codigo_material:    form.codigo_material.trim(),
      lote_poy:           form.lote_poy.trim(),
      lote_acabado:       form.lote_acabado.trim(),
      tipo_saida:         form.tipo_saida,
      volume_liquido_kg:  volumeLiq,
      volume_bruto_kg:    form.volume_bruto_kg ? parseFloat(form.volume_bruto_kg) : null,
      quantidade:         form.quantidade.trim() || null,
      unidade_id:         unidadeAtiva || '',
    }

    // Se offline: enfileira
    if (!isOnline) {
      addToQueue({ payload, usuario: { email: user?.email } })
      setOfflineQueue(getQueue())
      setConfirmacao(null)
      setForm(EMPTY_FORM)
      toast('📴 Sem internet — saída salva na fila offline!', 'warn')
      return
    }

    setLoading(true)
    try {
      const resultado = await criarSaida(payload, user)
      setConfirmacao(null)
      setUltimaSaida(resultado)
      setForm(EMPTY_FORM)
      load()
    } catch (e) {
      toast(e.message || 'Erro ao registrar saída.', 'error')
      setConfirmacao(null)
    } finally {
      setLoading(false)
    }
  }

  const handleGerarPDF = (saida, alocacoes) => {
    gerarRomaneioPDF(saida, alocacoes, config)
    toast('Romaneio PDF gerado!')
  }

  // Envia romaneio individual por e-mail
  const handleEmailIndividual = async () => {
    if (!ultimaSaida) return
    if (!user?.email) { toast('E-mail do usuário não encontrado.', 'error'); return }
    setEmailLoading(true)
    try {
      const pdfBase64 = gerarRomaneioBase64(ultimaSaida.saida, ultimaSaida.alocacoes, config)
      const res = await fetch('/api/send-romaneio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailDestino: user.email,
          nomeUsuario:  user.displayName || user.email,
          romaneios: [{
            ...ultimaSaida.saida,
            pdfBase64,
          }]
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar e-mail.')
      toast(`📧 Romaneio enviado para ${user.email}!`)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setEmailLoading(false)
    }
  }

  // Envia lote por e-mail (todos os romaneios de uma vez)
  const handleEmailLote = async () => {
    if (!user?.email) { toast('E-mail do usuário não encontrado.', 'error'); return }
    if (loteResultados.length === 0) return
    setEmailLoading(true)
    try {
      // Para cada resultado do lote, precisamos reconstruir a saída com alocações
      // loteResultados: [{romaneio, nf, volLiq, res}]
      const romaneiosPayload = loteResultados.map(r => {
        const saidaObj = r.res?.saida || {}
        const alocObj  = r.res?.alocacoes || []
        const pdfBase64 = gerarRomaneioBase64(saidaObj, alocObj, config)
        return { ...saidaObj, pdfBase64 }
      })
      const res = await fetch('/api/send-romaneio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailDestino: user.email,
          nomeUsuario:  user.displayName || user.email,
          romaneios:    romaneiosPayload,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar e-mail.')
      toast(`📧 ${loteResultados.length} romaneio(s) enviado(s) para ${user.email}!`)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setEmailLoading(false)
    }
  }

  // Zera o volume líquido para consumir exatamente o saldo disponível
  const handleZerarSaldo = () => {
    if (!form.tipo_saida || totalSaldo <= 0) return
    const temAbat = TIPOS_COM_ABATIMENTO.includes(form.tipo_saida)
    // volume_abatido = volume_liquido * (1 - 0.015) → inverso:
    const volLiqZero = temAbat
      ? (totalSaldo / (1 - 0.015)).toFixed(3)
      : totalSaldo.toFixed(3)
    set('volume_liquido_kg', volLiqZero)
  }

  const handleDeletarSaida = async (saida) => {
    try {
      await deletarSaida(saida.id, user)
      toast(`Romaneio ${saida.romaneio_microdata} excluído — saldo estornado nas NFs.`)
      setConfirmDeleteSaida(null)
      load()
    } catch (e) {
      toast(e.message || 'Erro ao excluir saída.', 'error')
      setConfirmDeleteSaida(null)
    }
  }

  const handleDeletar = async (saida) => {
    if (!window.confirm(`Excluir romaneio ${saida.romaneio_microdata}? O saldo será restaurado nas NFs.`)) return
    try {
      await deletarSaida(saida.id, user)
      toast('Saída excluída e saldo restaurado.')
      load()
    } catch (e) {
      toast(e.message || 'Erro ao excluir saída.', 'error')
    }
  }

  // Filtros
  const saidasFiltradas = useMemo(() => {
    return saidas.filter(s => {
      const txt = fBusca.toLowerCase()
      if (txt &&
        !s.romaneio_microdata?.toLowerCase().includes(txt) &&
        !(s.lote_poy || s.lote_produto || '')?.toLowerCase().includes(txt) &&
        !(s.lote_acabado || '')?.toLowerCase().includes(txt) &&
        !(s.codigo_material || s.codigo_produto || '')?.toLowerCase().includes(txt)) return false
      if (fTipo && s.tipo_saida !== fTipo) return false
      if (fDe && new Date(s.criado_em) < new Date(fDe + 'T00:00:00')) return false
      if (fAte && new Date(s.criado_em) > new Date(fAte + 'T23:59:59')) return false
      return true
    })
  }, [saidas, fBusca, fTipo, fDe, fAte])

  const temFiltro       = fBusca || fTipo || fDe || fAte
  const limparFiltros   = () => { setFBusca(''); setFTipo(''); setFDe(''); setFAte('') }
  const totalFiltrado   = saidasFiltradas.reduce((a, s) => a + Number(s.volume_abatido_kg), 0)
  const totalLiqFiltrado = saidasFiltradas.reduce((a, s) => a + Number(s.volume_liquido_kg || s.volume_bruto_kg || 0), 0)

  return (
    <div>
      <div className="page-header" style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12}}>
        <div>
          <div className="page-title"><span>↑</span> Saída de Material</div>
          <div className="page-sub">Registro de saídas com abatimento 1,5% e alocação FIFO</div>
        </div>
        <button className="btn btn-ghost" onClick={() => { exportarExcel(nfs, saidas); toast('Exportação concluída!') }}>
          📊 Excel
        </button>
      </div>

      {/* Banner offline */}
      {!isOnline && (
        <div style={{ background:'rgba(255,180,0,0.12)', border:'1px solid var(--warn)', borderRadius:10, padding:'10px 16px', marginBottom:16, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <span style={{fontSize:20}}>📴</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:700, color:'var(--warn)', fontSize:13}}>Modo Offline</div>
            <div style={{fontSize:12, color:'var(--text-dim)'}}>As saídas serão salvas localmente e sincronizadas ao reconectar.</div>
          </div>
          {offlineQueue.length > 0 && <span style={{background:'var(--warn)', color:'#000', borderRadius:12, padding:'2px 10px', fontSize:12, fontWeight:700}}>{offlineQueue.length} na fila</span>}
        </div>
      )}

      {/* Banner sincronização */}
      {isOnline && offlineQueue.length > 0 && (
        <div style={{ background:'rgba(0,195,100,0.1)', border:'1px solid var(--accent-2)', borderRadius:10, padding:'10px 16px', marginBottom:16, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <span style={{fontSize:20}}>🔄</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:700, color:'var(--accent-2)', fontSize:13}}>Fila Pendente</div>
            <div style={{fontSize:12, color:'var(--text-dim)'}}>{offlineQueue.length} saída(s) aguardando sincronização.</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={sincronizarFila} disabled={sincronizando}>
            {sincronizando ? '⏳ Sincronizando...' : '↑ Sincronizar Agora'}
          </button>
        </div>
      )}

      {/* ── Tabs — ocultas para supervisor ── */}
      {isSupervisor ? (
        <div style={{ marginBottom:20, padding:'10px 16px', background:'rgba(255,180,0,0.08)', border:'1px solid var(--warn)', borderRadius:10, fontSize:13, color:'var(--warn)', fontWeight:600 }}>
          👁 Modo visualização — Supervisores não podem registrar saídas.
        </div>
      ) : (
      <>
      <div style={{display:'flex', gap:0, marginBottom:20, borderBottom:'1px solid var(--border)'}}>
        {[{k:'simples', label:'➕ Saída Individual'}, {k:'lote', label:'📦 Saída em Lote'}].map(t => (
          <button key={t.k} onClick={() => setAba(t.k)} style={{
            padding:'10px 20px', background:'none', border:'none', cursor:'pointer', fontSize:13, fontWeight:600,
            color: aba === t.k ? 'var(--accent)' : 'var(--text-dim)',
            borderBottom: aba === t.k ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -1,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── ABA: SAÍDA INDIVIDUAL ── */}
      {aba === 'simples' && (
        <div className="card" style={{marginBottom:24}}>
          <div className="card-title">Registrar Nova Saída</div>

        {/* LINHA 1 — 4 obrigatórios */}
        <div className="form-grid-4" style={{marginBottom:14}}>
          <div className="form-group">
            <label className="form-label">Romaneio Microdata *</label>
            <input type="text" className="form-input" placeholder="Ex: 122041"
              value={form.romaneio_microdata} onChange={e => set('romaneio_microdata', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Código do Material *</label>
            <input type="text" className="form-input" placeholder="Ex: 140911"
              value={form.codigo_material} onChange={e => set('codigo_material', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Lote POY *</label>
            <input type="text" className="form-input" placeholder="Ex: 5327"
              value={form.lote_poy} onChange={e => set('lote_poy', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Tipo de Saída *</label>
            <select className="form-select" value={form.tipo_saida} onChange={e => set('tipo_saida', e.target.value)}>
              <option value="">Selecione...</option>
              {TIPOS_SAIDA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>

        {/* LINHA 2 — Volume + opcionais */}
        <div className="form-grid-4">
          <div className="form-group">
            <label className="form-label">Volume Líquido (kg) *</label>
            <input type="number" step="0.001" min="0" className="form-input" placeholder="0,000"
              value={form.volume_liquido_kg} onChange={e => set('volume_liquido_kg', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Volume Bruto (kg)</label>
            <input type="number" step="0.001" min="0" className="form-input" placeholder="Opcional"
              value={form.volume_bruto_kg} onChange={e => set('volume_bruto_kg', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Lote Acabado</label>
            <input type="text" className="form-input" placeholder="Opcional"
              value={form.lote_acabado} onChange={e => set('lote_acabado', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Quantidade</label>
            <input type="text" className="form-input" placeholder="Ex: 24 cones"
              value={form.quantidade} onChange={e => set('quantidade', e.target.value)} />
          </div>
        </div>

        {/* Saldo disponível para material+lote selecionados */}
        {(form.codigo_material || form.lote_poy) && (
          <div style={{marginTop:12, padding:'10px 14px', borderRadius:8,
            background: saldoInsuficiente ? 'rgba(255,80,80,0.08)' : 'rgba(0,195,100,0.07)',
            border: `1px solid ${saldoInsuficiente ? 'rgba(255,80,80,0.3)' : 'rgba(0,195,100,0.25)'}`,
            display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8
          }}>
            <span style={{fontSize:12, color:'var(--text-dim)'}}>
              Saldo disponível{form.codigo_material ? ` — Mat. ${form.codigo_material}` : ''}{form.lote_poy ? ` / Lote ${form.lote_poy}` : ''}
              {' '}({nfsFiltradas.length} NF{nfsFiltradas.length !== 1 ? 's' : ''})
            </span>
            <span style={{fontWeight:700, fontSize:14,
              color: saldoInsuficiente ? 'var(--danger)' : 'var(--accent-2)'}}>
              {fmt(totalSaldo)} kg
              {saldoInsuficiente && volumeAbatido > 0 && ` — faltam ${fmt(volumeAbatido - totalSaldo)} kg`}
            </span>
          </div>
        )}

        {/* Preview de abatimento */}
        {volumeLiq > 0 && form.tipo_saida && (
          <div className="abatimento-box" style={{marginTop:16}}>
            <div className="abatimento-row">
              <span className="abatimento-label">Volume Líquido Informado</span>
              <span className="abatimento-value">{fmt(volumeLiq)} kg</span>
            </div>
            {temAbatimento && (
              <div className="abatimento-row">
                <span className="abatimento-label">
                  Abatimento 1,5%
                  <span className="abatimento-badge" style={{marginLeft:6}}>
                    {TIPOS_SAIDA.find(t => t.value === form.tipo_saida)?.label}
                  </span>
                </span>
                <span className="abatimento-value" style={{color:'var(--warn)'}}>− {fmt(volumeLiq - volumeAbatido)} kg</span>
              </div>
            )}
            <div style={{borderTop:'1px solid var(--border)', paddingTop:8, marginTop:4}}>
              <div className="abatimento-row">
                <span className="abatimento-label" style={{fontWeight:700}}>
                  {temAbatimento ? 'Volume a Debitar do Estoque' : 'Volume a Debitar do Estoque'}
                </span>
                <span className="abatimento-value highlight">{fmt(volumeAbatido)} kg</span>
              </div>
            </div>
            {saldoInsuficiente && (
              <div style={{marginTop:8, padding:'10px 12px', background:'rgba(255,77,109,0.1)', borderRadius:6, display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8}}>
                <span style={{color:'var(--danger)', fontSize:12}}>
                  ⚠ Saldo insuficiente. Disponível: <strong>{fmt(totalSaldo)} kg</strong>
                </span>
                {totalSaldo > 0.001 && (
                  <button
                    className="btn btn-sm"
                    style={{background:'var(--accent)', color:'#fff', fontSize:11, padding:'4px 10px'}}
                    onClick={() => {
                      // Calcula o volume líquido que resulta em volumeAbatido == totalSaldo
                      const novoLiq = temAbatimento
                        ? totalSaldo / (1 - 0.015)
                        : totalSaldo
                      set('volume_liquido_kg', novoLiq.toFixed(4))
                    }}
                  >
                    ↓ Ajustar para Zerar Saldo ({fmt(temAbatimento ? totalSaldo / (1 - 0.015) : totalSaldo)} kg)
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{display:'flex', justifyContent:'flex-end', marginTop:20}}>
          <button
            className="btn btn-primary"
            onClick={handlePreConfirm}
            disabled={loading || saldoInsuficiente || !form.tipo_saida || !volumeLiq}
          >
            Revisar e Confirmar →
          </button>
        </div>
      </div>
      )} {/* fim aba simples */}

      {/* ── ABA: SAÍDA EM LOTE ── */}
      {aba === 'lote' && (
        <div className="card" style={{marginBottom:24}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
            <div className="card-title" style={{margin:0}}>📦 Saída em Lote — múltiplos romaneios</div>
            <button className="btn btn-ghost btn-sm" onClick={resetLote}>↺ Limpar</button>
          </div>

          {/* Configuração do lote */}
          <div className="form-grid-4" style={{marginBottom:16}}>
            <div className="form-group">
              <label className="form-label">Lote POY *</label>
              <select className="form-select" value={loteForm.lote_poy}
                onChange={e => setLoteForm(f => ({...f, lote_poy: e.target.value}))}>
                <option value="">Selecione o lote...</option>
                {lotesDisponiveis.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Tipo de Saída *</label>
              <select className="form-select" value={loteForm.tipo_saida}
                onChange={e => setLoteForm(f => ({...f, tipo_saida: e.target.value}))}>
                <option value="">Selecione o tipo...</option>
                {TIPOS_SAIDA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Lote Acabado</label>
              <input className="form-input" placeholder="Opcional" value={loteForm.lote_acabado}
                onChange={e => setLoteForm(f => ({...f, lote_acabado: e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="form-label">Filtrar Cód. Material</label>
              <input className="form-input" placeholder="Ex: 140911" value={loteForm.codigo_material}
                onChange={e => setLoteForm(f => ({...f, codigo_material: e.target.value}))} />
            </div>
          </div>

          {/* Aviso abatimento */}
          {loteForm.tipo_saida && TIPOS_COM_ABATIMENTO.includes(loteForm.tipo_saida) && (
            <div style={{background:'rgba(255,180,0,0.08)', border:'1px solid var(--warn)', borderRadius:8, padding:'8px 12px', fontSize:12, color:'var(--warn)', marginBottom:14}}>
              ⚠️ Abatimento de 1,5% será aplicado automaticamente em todos os romaneios deste lote.
            </div>
          )}

          {/* Sem lote selecionado */}
          {!loteForm.lote_poy && (
            <div className="empty" style={{padding:'30px 0'}}>
              <div className="empty-icon">📦</div>
              <div className="empty-text">Selecione o lote POY para carregar as NFs disponíveis</div>
            </div>
          )}

          {/* Linhas de NFs */}
          {loteLinhas.length === 0 && loteForm.lote_poy && (
            <div className="empty" style={{padding:'20px 0'}}>
              <div className="empty-icon">🔍</div>
              <div className="empty-text">Nenhuma NF com saldo disponível para este lote</div>
            </div>
          )}

          {loteLinhas.length > 0 && (
            <>
              <div style={{overflowX:'auto', marginBottom:16}}>
                <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
                  <thead>
                    <tr style={{background:'rgba(255,255,255,0.04)'}}>
                      <th style={{padding:'8px 10px', textAlign:'center', width:36}}>
                        <input type="checkbox" checked={loteLinhas.every(l => l.incluir)}
                          onChange={e => setLoteLinhas(ls => ls.map(l => ({...l, incluir: e.target.checked})))} />
                      </th>
                      <th style={{padding:'8px 10px', textAlign:'left', color:'var(--text-dim)', fontWeight:600}}>NF</th>
                      <th style={{padding:'8px 10px', textAlign:'left', color:'var(--text-dim)', fontWeight:600}}>Emissão</th>
                      <th style={{padding:'8px 10px', textAlign:'left', color:'var(--text-dim)', fontWeight:600}}>Cód.</th>
                      <th style={{padding:'8px 10px', textAlign:'right', color:'var(--text-dim)', fontWeight:600}}>Saldo kg</th>
                      <th style={{padding:'8px 10px', textAlign:'left', color:'var(--text-dim)', fontWeight:600}}>Romaneio *</th>
                      <th style={{padding:'8px 10px', textAlign:'right', color:'var(--text-dim)', fontWeight:600}}>Vol. Líq. kg *</th>
                      <th style={{padding:'8px 10px', textAlign:'right', color:'var(--text-dim)', fontWeight:600}}>Vol. Final kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loteLinhas.map((linha, idx) => {
                      const volLiq = parseFloat(linha.volume_liquido_kg) || 0
                      const volFinal = calcularVolumeAbatido(volLiq, loteForm.tipo_saida)
                      const saldo = Number(linha.nf.volume_saldo_kg)
                      const excede = volFinal > saldo + 0.01
                      return (
                        <tr key={linha.nf.id} style={{
                          borderBottom:'1px solid rgba(255,255,255,0.05)',
                          opacity: linha.incluir ? 1 : 0.4,
                          background: excede ? 'rgba(255,60,60,0.06)' : undefined
                        }}>
                          <td style={{padding:'8px 10px', textAlign:'center'}}>
                            <input type="checkbox" checked={linha.incluir}
                              onChange={e => setLinha(idx, 'incluir', e.target.checked)} />
                          </td>
                          <td style={{padding:'8px 10px', fontWeight:700, fontFamily:'monospace'}}>{linha.nf.numero_nf}</td>
                          <td style={{padding:'8px 10px', fontSize:12, color:'var(--text-dim)'}}>
                            {linha.nf.data_emissao ? new Date(linha.nf.data_emissao).toLocaleDateString('pt-BR') : '—'}
                          </td>
                          <td style={{padding:'8px 10px', fontSize:12}}>{linha.nf.codigo_material || '—'}</td>
                          <td style={{padding:'8px 10px', textAlign:'right', color:'var(--accent-2)', fontWeight:600, fontFamily:'monospace'}}>
                            {fmt(saldo)}
                            <button title="Usar saldo total" style={{marginLeft:6, background:'none', border:'none', cursor:'pointer', fontSize:10, color:'var(--accent)', padding:0}}
                              onClick={() => {
                                const temAbat = TIPOS_COM_ABATIMENTO.includes(loteForm.tipo_saida)
                                const liq = temAbat ? (saldo / (1 - 0.015)).toFixed(3) : saldo.toFixed(3)
                                setLinha(idx, 'volume_liquido_kg', liq)
                              }}>↓max</button>
                          </td>
                          <td style={{padding:'6px 10px'}}>
                            <input
                              className="form-input"
                              style={{width:130, fontFamily:'monospace', borderColor: excede ? 'var(--danger)' : undefined}}
                              placeholder="Ex: 122041"
                              value={linha.romaneio}
                              disabled={!linha.incluir}
                              onChange={e => setLinha(idx, 'romaneio', e.target.value)}
                            />
                          </td>
                          <td style={{padding:'6px 10px'}}>
                            <input
                              className="form-input"
                              type="number" step="0.001" min="0"
                              style={{width:110, textAlign:'right', fontFamily:'monospace', borderColor: excede ? 'var(--danger)' : undefined}}
                              placeholder="0,000"
                              value={linha.volume_liquido_kg}
                              disabled={!linha.incluir}
                              onChange={e => setLinha(idx, 'volume_liquido_kg', e.target.value)}
                            />
                          </td>
                          <td style={{padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontWeight:600, color: excede ? 'var(--danger)' : 'var(--accent)'}}>
                            {volLiq > 0 ? fmt(volFinal) : '—'}
                            {excede && <div style={{fontSize:10, color:'var(--danger)'}}>excede saldo</div>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{borderTop:'2px solid var(--border)', background:'rgba(255,255,255,0.03)'}}>
                      <td colSpan={6} style={{padding:'8px 10px', fontSize:12, color:'var(--text-dim)'}}>
                        {loteLinhas.filter(l => l.incluir && parseFloat(l.volume_liquido_kg) > 0).length} romaneio(s) a gerar
                      </td>
                      <td style={{padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontWeight:700}}>
                        {fmt(loteLinhas.filter(l=>l.incluir).reduce((a,l) => a + (parseFloat(l.volume_liquido_kg)||0), 0))}
                      </td>
                      <td style={{padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontWeight:700, color:'var(--accent)'}}>
                        {fmt(loteLinhas.filter(l=>l.incluir).reduce((a,l) => a + calcularVolumeAbatido(parseFloat(l.volume_liquido_kg)||0, loteForm.tipo_saida), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div style={{display:'flex', justifyContent:'flex-end', gap:10}}>
                <button className="btn btn-ghost" onClick={resetLote}>↺ Recomeçar</button>
                <button
                  className="btn btn-primary"
                  onClick={handleGerarLote}
                  disabled={loteLoading || !loteForm.tipo_saida || loteLinhas.filter(l=>l.incluir && parseFloat(l.volume_liquido_kg)>0).length === 0}
                >
                  {loteLoading ? '⏳ Gerando...' : `⚡ Gerar ${loteLinhas.filter(l=>l.incluir && parseFloat(l.volume_liquido_kg)>0).length} Romaneio(s)`}
                </button>
              </div>
            </>
          )}

          {/* Resultados */}
          {loteResultados.length > 0 && (
            <div style={{marginTop:20, background:'rgba(0,195,100,0.08)', border:'1px solid var(--accent-2)', borderRadius:10, padding:16}}>
              <div style={{fontWeight:700, color:'var(--accent-2)', fontSize:14, marginBottom:12}}>
                ✅ {loteResultados.length} romaneio(s) gerado(s) com sucesso!
              </div>
              {loteResultados.map((r, i) => (
                <div key={i} style={{display:'flex', justifyContent:'space-between', fontSize:13, padding:'4px 0', borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                  <span style={{fontFamily:'monospace', fontWeight:600}}>{r.romaneio}</span>
                  <span style={{color:'var(--text-dim)'}}>NF {r.nf}</span>
                  <span style={{color:'var(--accent)', fontFamily:'monospace'}}>{fmt(calcularVolumeAbatido(r.volLiq, loteForm.tipo_saida))} kg</span>
                </div>
              ))}
              <div style={{display:'flex', gap:8, marginTop:12, flexWrap:'wrap'}}>
                <button className="btn btn-ghost btn-sm" onClick={resetLote}>Novo lote</button>
              </div>
            </div>
          )}
        </div>
      )} {/* fim aba lote */}
      </> )} {/* fim bloco não-supervisor */}

      {/* ── Filtros + Histórico ── */}
      <div className="card" style={{marginBottom:16, paddingBottom:0}}>
        <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', paddingBottom:16}}>
          <div className="card-title" style={{margin:0, flex:'1 1 140px'}}>Histórico de Saídas</div>
          <input className="form-input" style={{maxWidth:200}} placeholder="🔍 Romaneio, lote..."
            value={fBusca} onChange={e => setFBusca(e.target.value)} />
          <select className="form-select" style={{maxWidth:180}} value={fTipo} onChange={e => setFTipo(e.target.value)}>
            <option value="">Todos os tipos</option>
            {TIPOS_SAIDA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input type="date" className="form-input" style={{maxWidth:148}} value={fDe} onChange={e => setFDe(e.target.value)} title="Data inicial" />
          <input type="date" className="form-input" style={{maxWidth:148}} value={fAte} onChange={e => setFAte(e.target.value)} title="Data final" />
          {temFiltro && <button className="btn btn-ghost btn-sm" onClick={limparFiltros}>✕ Limpar</button>}
        </div>

        {temFiltro && saidasFiltradas.length > 0 && (
          <div style={{display:'flex', gap:20, padding:'8px 0 14px', fontSize:12, color:'var(--text-dim)', flexWrap:'wrap'}}>
            <span>📋 <strong style={{color:'var(--text)'}}>{saidasFiltradas.length}</strong> saída{saidasFiltradas.length !== 1 ? 's' : ''}</span>
            <span>Vol. Líq.: <strong style={{color:'var(--text)'}}>{fmt(totalLiqFiltrado)} kg</strong></span>
            <span>Vol. Final: <strong style={{color:'var(--accent)'}}>{fmt(totalFiltrado)} kg</strong></span>
          </div>
        )}
      </div>

      {/* ── Tabela ── */}
      <div className="card">
        {loadingList ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="col-hide-mobile">Romaneio</th>
                  <th>Cód.</th>
                  <th>Lote POY</th>
                  <th className="col-hide-mobile">Lote Acab.</th>
                  <th>Tipo</th>
                  <th className="td-right col-hide-mobile">Líq. (kg)</th>
                  <th className="td-right col-hide-mobile">Final (kg)</th>
                  <th className="col-hide-mobile">Qtd</th>
                  <th>Data</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {saidasFiltradas.length === 0 && (
                  <tr><td colSpan={10}>
                    <div className="empty">
                      <div className="empty-icon">{temFiltro ? '🔍' : '📋'}</div>
                      <div className="empty-text">{temFiltro ? 'Nenhuma saída encontrada com esses filtros.' : 'Nenhuma saída registrada ainda.'}</div>
                    </div>
                  </td></tr>
                )}
                {saidasFiltradas.map(s => (
                  <tr key={s.id}>
                    <td className="td-mono col-hide-mobile" style={{fontWeight:600}}>{s.romaneio_microdata}</td>
                    <td>{s.codigo_material || s.codigo_produto}</td>
                    <td className="td-mono">{s.lote_poy || s.lote_produto || '—'}</td>
                    <td className="td-mono col-hide-mobile" style={{color:'var(--text-dim)'}}>{s.lote_acabado || '—'}</td>
                    <td>{tipoBadge(s.tipo_saida)}</td>
                    <td className="td-right td-mono col-hide-mobile">{fmt(s.volume_liquido_kg || s.volume_bruto_kg)}</td>
                    <td className="td-right td-mono col-hide-mobile" style={{color:'var(--accent)', fontWeight:600}}>{fmt(s.volume_abatido_kg)}</td>
                    <td className="col-hide-mobile" style={{fontSize:12, color:'var(--text-dim)'}}>{s.quantidade || '—'}</td>
                    <td style={{fontSize:11, color:'var(--text-dim)', whiteSpace:'nowrap'}}>
                      {s.criado_em ? format(new Date(s.criado_em), 'dd/MM/yy') : '—'}
                    </td>
                    <td style={{whiteSpace:'nowrap'}}>
                      <div style={{display:'flex', gap:2}}>
                        <button className="btn btn-ghost btn-sm" title="Gerar Romaneio PDF"
                          onClick={() => handleGerarPDF(s, s.alocacao_saida || [])}>📄</button>
                        {!isSupervisor && (
                        <button className="btn btn-ghost btn-sm" title="Excluir saída"
                          onClick={() => setConfirmDeleteSaida(s)}
                          style={{color:'var(--danger)'}}>🗑</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmacao && (
        <ConfirmacaoModal
          form={form}
          preview={confirmacao.preview}
          onConfirm={handleConfirmar}
          onCancel={() => setConfirmacao(null)}
          loading={loading}
        />
      )}

      {ultimaSaida && (
        <SucessoModal
          ultimaSaida={ultimaSaida}
          onClose={() => setUltimaSaida(null)}
          onPDF={() => handleGerarPDF(ultimaSaida.saida, ultimaSaida.alocacoes)}
        />
      )}

      {confirmDeleteSaida && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteSaida(null)}>
          <div className="modal" style={{maxWidth:420}} onClick={e => e.stopPropagation()}>
            <div className="modal-title" style={{color:'var(--danger)'}}>🗑 Excluir Saída</div>
            <p style={{color:'var(--text)', marginBottom:12}}>
              Deseja excluir o romaneio <strong>{confirmDeleteSaida.romaneio_microdata}</strong>?
            </p>
            <p style={{fontSize:12, color:'var(--text-dim)', marginBottom:20}}>
              O volume de <strong>{fmt(confirmDeleteSaida.volume_abatido_kg)} kg</strong> será estornado nas NFs de entrada correspondentes.
            </p>
            <div style={{display:'flex', gap:10, justifyContent:'flex-end'}}>
              <button className="btn btn-ghost" onClick={() => setConfirmDeleteSaida(null)}>Cancelar</button>
              <button className="btn" style={{background:'var(--danger)', color:'#fff'}}
                onClick={() => handleDeletarSaida(confirmDeleteSaida)}>
                Excluir e Estornar
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast toasts={toasts} />
    </div>
  )
}
