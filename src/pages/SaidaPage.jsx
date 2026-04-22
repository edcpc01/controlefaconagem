import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import {
  listarSaidas, criarSaida, deletarSaida, listarNFsEntrada, previewFIFO,
  TIPOS_SAIDA, TIPOS_COM_ABATIMENTO,
  calcularVolumeAbatido, getPercentualAbatimento, MATERIAL_ESPECIAL_135612,
  gerarRomaneioPDF, gerarRomaneioBase64, gerarMultiSaidaPDF, exportarExcel, carregarConfig
} from '../lib/faconagem'
import { useAuth } from '../lib/AuthContext'
import { useUser } from '../lib/UserContext'
import { useOperacao } from '../lib/OperacaoContext'
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
  const map = { faturamento:'badge-blue', sucata:'badge-danger', estopa:'badge-warn', dev_qualidade:'badge-green', dev_processo:'badge-green', dev_final_campanha:'badge-green', insumo:'badge-blue' }
  const label = TIPOS_SAIDA.find(t => t.value === tipo)?.label || tipo
  return <span className={`badge ${map[tipo] || 'badge-blue'}`}>{label}</span>
}

const fmt = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── Modal de Confirmação FIFO ─────────────────────────────────────────────
function ConfirmacaoModal({ form, preview, previewsCompanion, onConfirm, onCancel, loading, percentualBase }) {
  const volumeLiq    = parseFloat(form.volume_liquido_kg) || 0
  const temAbat      = TIPOS_COM_ABATIMENTO.includes(form.tipo_saida)
  const isEsp135612  = form.codigo_material === MATERIAL_ESPECIAL_135612.codigo
  const percAbat     = getPercentualAbatimento(form.codigo_material, percentualBase)
  const volumeFinal  = calcularVolumeAbatido(volumeLiq, form.tipo_saida, form.codigo_material, percentualBase)
  const volumeAbat   = temAbat ? volumeLiq * percAbat : 0
  const tipoLbl      = TIPOS_SAIDA.find(t => t.value === form.tipo_saida)?.label || ''
  const percLabel    = `${(percAbat * 100).toFixed(1).replace('.', ',')}%`

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{maxWidth:600}} onClick={e => e.stopPropagation()}>
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
              <span className="abatimento-label">
                Abatimento {percLabel}
                {isEsp135612 && <span style={{marginLeft:6, fontSize:10, background:'var(--warn)', color:'#000', borderRadius:4, padding:'1px 6px', fontWeight:700}}>REGRA 135612</span>}
                {' '}({tipoLbl})
              </span>
              <span className="abatimento-value" style={{color:'var(--warn)'}}>− {fmt(volumeAbat)} kg</span>
            </div>
          )}
          <div style={{borderTop:'1px solid var(--border)', paddingTop:8, marginTop:4}}>
            <div className="abatimento-row">
              <span className="abatimento-label" style={{fontWeight:700}}>Volume a Debitar do Estoque (Mat. {form.codigo_material})</span>
              <span className="abatimento-value highlight">{fmt(volumeFinal)} kg</span>
            </div>
          </div>
        </div>

        <div style={{fontSize:12, fontWeight:600, color:'var(--blue-200)', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.04em'}}>
          Débito nas NFs de Entrada — Mat. {form.codigo_material} (FIFO):
        </div>

        <div className="table-wrap" style={{marginBottom: isEsp135612 && previewsCompanion?.length ? 16 : 4}}>
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

        {/* Seção companion — apenas para material 135612 */}
        {isEsp135612 && previewsCompanion?.length > 0 && (
          <>
            <div style={{fontSize:12, fontWeight:600, color:'var(--warn)', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.04em'}}>
              Débito do Abatimento ({percLabel}) — Matérias-primas de Entrada:
            </div>
            {previewsCompanion.map((comp, ci) => (
              <div key={ci} style={{marginBottom:12}}>
                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6}}>
                  <span style={{fontSize:12, fontWeight:700, color:'var(--text-dim)'}}>
                    Mat. {comp.codigo_material}
                    <span style={{marginLeft:6, color:'var(--blue-200)', fontWeight:400}}>
                      ({(comp.percentual * 100).toFixed(0)}% = {fmt(comp.volume)} kg)
                    </span>
                  </span>
                  {comp.saldoInsuficiente && (
                    <span style={{fontSize:11, color:'var(--danger)', fontWeight:600}}>⚠ Saldo insuficiente</span>
                  )}
                </div>
                <div className="table-wrap">
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
                      {comp.preview.map((p, i) => (
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
                      {comp.preview.length === 0 && (
                        <tr><td colSpan={5} style={{textAlign:'center', color:'var(--danger)', fontSize:12}}>Sem NFs com saldo para este material</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        )}

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
  const s            = ultimaSaida.saida
  const alocComp     = ultimaSaida.alocacoesCompanion || []
  const isEsp135612  = s.codigo_material === MATERIAL_ESPECIAL_135612.codigo
  const percAbatPct  = s.percentual_abatimento ? `${(s.percentual_abatimento * 100).toFixed(1).replace('.', ',')}%` : '3,5%'

  // Agrupa companion por material
  const compPorMat = {}
  for (const aloc of alocComp) {
    const cod = aloc.codigo_material_companion || '?'
    if (!compPorMat[cod]) compPorMat[cod] = { volume: 0, nfs: [] }
    compPorMat[cod].volume += Number(aloc.volume_alocado_kg)
    compPorMat[cod].nfs.push(aloc)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth:560}} onClick={e => e.stopPropagation()}>
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
            <span className="abatimento-label">Volume Debitado do Estoque (Mat. {s.codigo_material})</span>
            <span className="abatimento-value highlight">{fmt(s.volume_abatido_kg)} kg</span>
          </div>
        </div>

        <div style={{fontSize:12, fontWeight:600, color:'var(--blue-200)', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.04em'}}>
          Alocações FIFO — Mat. {s.codigo_material}
        </div>
        <div className="table-wrap" style={{marginBottom: isEsp135612 && alocComp.length ? 16 : 0}}>
          <table>
            <thead><tr><th>NF</th><th>Emissão</th><th className="td-right">Debitado (kg)</th></tr></thead>
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

        {/* Seção companion — apenas 135612 */}
        {isEsp135612 && alocComp.length > 0 && (
          <>
            <div style={{fontSize:12, fontWeight:600, color:'var(--warn)', margin:'16px 0 10px', textTransform:'uppercase', letterSpacing:'0.04em'}}>
              Abatimento Óleo de Encimagem Especial ({percAbatPct}) — {fmt(s.volume_abatimento_kg ?? alocComp.reduce((a,c) => a + Number(c.volume_alocado_kg), 0))} kg
            </div>
            {MATERIAL_ESPECIAL_135612.distribuicao.map(dist => {
              const grupo = compPorMat[dist.codigo_material]
              if (!grupo) return null
              return (
                <div key={dist.codigo_material} style={{marginBottom:10}}>
                  <div style={{fontSize:11, fontWeight:700, color:'var(--text-dim)', marginBottom:4}}>
                    Mat. {dist.codigo_material} — {(dist.percentual * 100).toFixed(0)}% = {fmt(grupo.volume)} kg
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>NF</th><th>Emissão</th><th className="td-right">Debitado (kg)</th></tr></thead>
                      <tbody>
                        {grupo.nfs.map((a, i) => (
                          <tr key={i}>
                            <td className="td-mono">{a.numero_nf}</td>
                            <td>{a.data_emissao ? format(new Date(a.data_emissao), 'dd/MM/yyyy') : '—'}</td>
                            <td className="td-right td-mono">{fmt(a.volume_alocado_kg)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </>
        )}

        <div className="modal-actions" style={{marginTop:16}}>
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
  const { unidadeAtiva, isSupervisor, isSupervisorCorradi } = useUser() || {}
  const readOnly = isSupervisor || isSupervisorCorradi
  const { colecoes, operacaoAtiva } = useOperacao() || {}
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
  // Override manual do abatimento para material 135612
  const [abatimentoOverride, setAbatimentoOverride] = useState(null)   // null = usa cálculo automático
  const [editandoAbatimento, setEditandoAbatimento] = useState(false)

  // Offline
  const [isOnline, setIsOnline]       = useState(navigator.onLine)
  const [offlineQueue, setOfflineQueue] = useState(getQueue())
  const [sincronizando, setSincronizando] = useState(false)

  // ── Multi-saídas (1 romaneio, N materiais) ───────────────────────
  const [aba, setAba]             = useState('simples') // 'simples' | 'multi'
  const [multiForm, setMultiForm] = useState({ romaneio_microdata: '', tipo_saida: '', lote_acabado: '' })
  const [multiLinhas, setMultiLinhas] = useState([{ _id: 0, codigo_material: '', lote_poy: '', volume: '', incluir: true }])
  const [multiLoading, setMultiLoading] = useState(false)
  const [multiResultado, setMultiResultado] = useState(null)
  const multiNextId = useRef(1)

  // Filtros do histórico (hooks agrupados no topo)
  const [fBusca, setFBusca] = useState('')
  const [fTipo, setFTipo]   = useState('')
  const [fDe, setFDe]       = useState('')
  const [fAte, setFAte]     = useState('')

  function toast(msg, type = 'success') {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }

  const load = () => {
    setLoadingList(true)
    Promise.all([listarSaidas(unidadeAtiva || '', colecoes), listarNFsEntrada(unidadeAtiva || '', colecoes)])
      .then(([s, n]) => { setSaidas(s); setNfs(n) })
      .catch(e => toast(e.message, 'error'))
      .finally(() => setLoadingList(false))
  }

  const addMultiLinha = () =>
    setMultiLinhas(ls => [...ls, { _id: multiNextId.current++, codigo_material: '', lote_poy: '', volume: '', incluir: true }])
  const removeMultiLinha = (id) => setMultiLinhas(ls => ls.filter(l => l._id !== id))
  const setMultiLinha = (id, campo, valor) =>
    setMultiLinhas(ls => ls.map(l => l._id === id ? {...l, [campo]: valor} : l))

  // Cálculos do formulário (declarados antes dos callbacks que os usam)
  const percentualBase   = config.abatimento_pct != null ? config.abatimento_pct : null
  const loteDigitos      = operacaoAtiva === 'nilit' ? 5 : 4

  const getSaldoMultiLinha = useCallback((linha) => {
    return nfs.filter(nf => {
      if (Number(nf.volume_saldo_kg) <= 0.001) return false
      if (linha.codigo_material && nf.codigo_material !== linha.codigo_material) return false
      if (linha.lote_poy) {
        const lNF  = String(nf.lote || '').substring(0, loteDigitos)
        const lLin = String(linha.lote_poy).substring(0, loteDigitos)
        if (lNF !== lLin) return false
      }
      if (unidadeAtiva && (nf.unidade_id || '') !== unidadeAtiva) return false
      return true
    }).reduce((a, n) => a + Number(n.volume_saldo_kg), 0)
  }, [nfs, loteDigitos, unidadeAtiva])

  const resetMulti = () => {
    setMultiForm({ romaneio_microdata: '', tipo_saida: '', lote_acabado: '' })
    setMultiLinhas([{ _id: 0, codigo_material: '', lote_poy: '', volume: '', incluir: true }])
    setMultiResultado(null)
    multiNextId.current = 1
  }

  const handleGerarMulti = async () => {
    if (!multiForm.romaneio_microdata.trim()) { toast('Informe o número do romaneio.', 'error'); return }
    if (!multiForm.tipo_saida) { toast('Selecione o tipo de saída.', 'error'); return }
    const ativas = multiLinhas.filter(l => l.incluir && l.codigo_material.trim() && parseFloat(l.volume) > 0)
    if (ativas.length === 0) { toast('Nenhuma linha ativa com material e volume preenchidos.', 'error'); return }
    for (const l of ativas) {
      const saldo    = getSaldoMultiLinha(l)
      const volFinal = calcularVolumeAbatido(parseFloat(l.volume), multiForm.tipo_saida, l.codigo_material, percentualBase)
      if (volFinal > saldo + 0.01) {
        toast(`Saldo insuficiente: Mat. ${l.codigo_material}${l.lote_poy ? ` / lote ${l.lote_poy}` : ''}.`, 'error'); return
      }
    }

    setMultiLoading(true)
    const resultItens = []
    const erros = []

    for (const l of ativas) {
      const volLiq = parseFloat(l.volume)
      try {
        const res = await criarSaida({
          romaneio_microdata: multiForm.romaneio_microdata.trim(),
          codigo_material:    l.codigo_material.trim(),
          lote_poy:           l.lote_poy?.trim() || '',
          lote_acabado:       multiForm.lote_acabado.trim() || '',
          tipo_saida:         multiForm.tipo_saida,
          volume_liquido_kg:  volLiq,
          volume_bruto_kg:    null,
          quantidade:         null,
          unidade_id:         unidadeAtiva || '',
          percentual_base:    percentualBase,
        }, user, colecoes)
        resultItens.push({
          codigo_material:   l.codigo_material.trim(),
          lote_poy:          l.lote_poy?.trim() || '',
          descricao_material: nfs.find(n => n.codigo_material === l.codigo_material.trim())?.descricao_material || '',
          volume_liquido_kg: volLiq,
          volume_abatido_kg: res.saida.volume_abatido_kg,
        })
      } catch (e) {
        erros.push({ material: l.codigo_material, erro: e.message })
      }
    }

    setMultiLoading(false)
    if (resultItens.length > 0) {
      setMultiResultado({ itens: resultItens, erros })
      toast(`✅ ${resultItens.length} baixa(s) no romaneio ${multiForm.romaneio_microdata}!`)
      load()
    }
    if (erros.length > 0) toast(`⚠️ ${erros.length} erro(s): ${erros.map(e => e.material).join(', ')}`, 'error')
  }

  useEffect(() => { load(); carregarConfig(colecoes).then(setConfig) }, [unidadeAtiva, operacaoAtiva])

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
        await criarSaida(item.payload, item.usuario, colecoes)
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
  const volumeLiq        = parseFloat(form.volume_liquido_kg) || 0
  const temAbatimento    = TIPOS_COM_ABATIMENTO.includes(form.tipo_saida)
  const isEspecial135612 = form.codigo_material === MATERIAL_ESPECIAL_135612.codigo
  const percAbat         = getPercentualAbatimento(form.codigo_material, percentualBase)
  // volumeAbatimento: valor efetivo do abatimento companion (pode ser override manual)
  const volumeAbatimentoBase = temAbatimento ? volumeLiq * percAbat : 0
  const volumeAbatimento = (isEspecial135612 && abatimentoOverride != null)
    ? abatimentoOverride
    : volumeAbatimentoBase
  // volumeAbatido: o que é debitado das NFs do próprio material 135612
  const volumeAbatido = isEspecial135612 && temAbatimento
    ? volumeLiq - volumeAbatimento
    : calcularVolumeAbatido(volumeLiq, form.tipo_saida, form.codigo_material, percentualBase)

  // Saldo disponível filtrado por código do material + lote POY da unidade ativa
  const nfsFiltradas = useMemo(() => {
    return nfs.filter(nf => {
      if (form.codigo_material && nf.codigo_material !== form.codigo_material) return false
      if (form.lote_poy) {
        const loteNF    = String(nf.lote || '').substring(0, loteDigitos)
        const loteSaida = String(form.lote_poy).substring(0, loteDigitos)
        if (loteNF !== loteSaida) return false
      }
      return true
    })
  }, [nfs, form.codigo_material, form.lote_poy, loteDigitos])

  const totalSaldo       = nfsFiltradas.reduce((a, n) => a + Number(n.volume_saldo_kg), 0)
  const saldoInsuficiente = volumeAbatido > totalSaldo + 0.01

  // Limpa override quando troca de material
  useEffect(() => {
    setAbatimentoOverride(null)
    setEditandoAbatimento(false)
  }, [form.codigo_material])

  const handlePreConfirm = async () => {
    const isInsumoSaida = form.tipo_saida === 'insumo'
    if (!form.romaneio_microdata || !form.codigo_material || (!isInsumoSaida && !form.lote_poy) || !form.tipo_saida || !form.volume_liquido_kg) {
      toast('Preencha os campos obrigatórios (*).', 'error'); return
    }
    if (nfsFiltradas.length === 0) {
      toast(`Nenhuma NF encontrada para o material "${form.codigo_material}"${form.lote_poy ? ` / lote "${form.lote_poy}"` : ''} nesta unidade.`, 'error'); return
    }
    if (saldoInsuficiente) {
      toast(`Saldo insuficiente! Disponível para este material/lote: ${fmt(totalSaldo)} kg`, 'error'); return
    }
    const { preview, previewsCompanion } = await previewFIFO(volumeAbatido, {
      codigoMaterial:           form.codigo_material,
      lotePoy:                  form.lote_poy,
      unidadeId:                unidadeAtiva || '',
      volumeLiquido:            volumeLiq,
      volumeAbatimentoOverride: isEspecial135612 ? volumeAbatimento : null,
      percentualBase,
      loteDigitos,
      colecoes,
    })
    setConfirmacao({ preview, previewsCompanion })
  }

  const handleConfirmar = async () => {
    const payload = {
      romaneio_microdata: form.romaneio_microdata.trim(),
      codigo_material:    form.codigo_material.trim(),
      lote_poy:           form.lote_poy.trim(),
      lote_acabado:       form.lote_acabado.trim(),
      tipo_saida:         form.tipo_saida,
      volume_liquido_kg:           volumeLiq,
      volume_bruto_kg:             form.volume_bruto_kg ? parseFloat(form.volume_bruto_kg) : null,
      quantidade:                  form.quantidade.trim() || null,
      unidade_id:                  unidadeAtiva || '',
      volume_abatimento_override:  isEspecial135612 ? volumeAbatimento : null,
      percentual_base:             percentualBase,
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
      const resultado = await criarSaida(payload, user, colecoes)
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

  const handleGerarPDF = (saida, alocacoes, alocacoesCompanion = []) => {
    gerarRomaneioPDF(saida, alocacoes, config, alocacoesCompanion)
    toast('Romaneio PDF gerado!')
  }

  // Envia romaneio individual por e-mail
  const handleEmailIndividual = async () => {
    if (!ultimaSaida) return
    if (!user?.email) { toast('E-mail do usuário não encontrado.', 'error'); return }
    setEmailLoading(true)
    try {
      const pdfBase64 = gerarRomaneioBase64(
        ultimaSaida.saida,
        ultimaSaida.alocacoes,
        config,
        ultimaSaida.alocacoesCompanion || []
      )
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

  // Zera o volume líquido para consumir exatamente o saldo disponível
  const handleZerarSaldo = () => {
    if (!form.tipo_saida || totalSaldo <= 0) return
    const temAbat = TIPOS_COM_ABATIMENTO.includes(form.tipo_saida)
    const perc = getPercentualAbatimento(form.codigo_material)
    const volLiqZero = temAbat
      ? (totalSaldo / (1 - perc)).toFixed(3)
      : totalSaldo.toFixed(3)
    set('volume_liquido_kg', volLiqZero)
  }

  const handleDeletarSaida = async (saida) => {
    try {
      await deletarSaida(saida.id, user, colecoes)
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
      await deletarSaida(saida.id, user, colecoes)
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
          <div className="page-sub">
            Registro de saídas com abatimento FIFO ({percentualBase != null ? `${(percentualBase * 100).toFixed(1).replace('.', ',')}%` : '1,5%'} padrão · 3,5% para mat. 135612)
          </div>
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
      {readOnly ? (
        <div style={{ marginBottom:20, padding:'10px 16px', background:'rgba(255,180,0,0.08)', border:'1px solid var(--warn)', borderRadius:10, fontSize:13, color:'var(--warn)', fontWeight:600 }}>
          👁 Modo visualização — Supervisores não podem registrar saídas.
        </div>
      ) : (
      <>
      <div style={{display:'flex', gap:0, marginBottom:20, borderBottom:'1px solid var(--border)'}}>
        {[{k:'simples', label:'➕ Saída Individual'}, {k:'multi', label:'📋 Multi-saídas'}].map(t => (
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
            <label className="form-label">{form.tipo_saida === 'insumo' ? 'Lote POY' : 'Lote POY *'}</label>
            <input type="text" className="form-input" placeholder={form.tipo_saida === 'insumo' ? 'Opcional' : 'Ex: 5327'}
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
            <label className="form-label">{form.tipo_saida === 'insumo' ? 'Volume / Qtd *' : 'Volume Líquido (kg) *'}</label>
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
              {fmt(totalSaldo)}{form.tipo_saida !== 'insumo' ? ' kg' : ''}
              {saldoInsuficiente && volumeAbatido > 0 && ` — faltam ${fmt(volumeAbatido - totalSaldo)}${form.tipo_saida !== 'insumo' ? ' kg' : ''}`}
            </span>
          </div>
        )}

        {/* Preview de abatimento */}
        {volumeLiq > 0 && form.tipo_saida && (
          <div className="abatimento-box" style={{marginTop:16}}>
            <div className="abatimento-row">
              <span className="abatimento-label">{form.tipo_saida === 'insumo' ? 'Volume / Qtd Informado' : 'Volume Líquido Informado'}</span>
              <span className="abatimento-value">{fmt(volumeLiq)}{form.tipo_saida !== 'insumo' ? ' kg' : ''}</span>
            </div>
            {temAbatimento && (
              <div className="abatimento-row">
                <span className="abatimento-label">
                  Abatimento {(percAbat * 100).toFixed(1).replace('.', ',')}%
                  {isEspecial135612 && <span style={{marginLeft:6, fontSize:10, background:'var(--warn)', color:'#000', borderRadius:4, padding:'1px 6px', fontWeight:700}}>REGRA 135612</span>}
                  <span className="abatimento-badge" style={{marginLeft:6}}>
                    {TIPOS_SAIDA.find(t => t.value === form.tipo_saida)?.label}
                  </span>
                  {isEspecial135612 && abatimentoOverride != null && (
                    <span style={{marginLeft:6, fontSize:10, background:'var(--accent)', color:'#fff', borderRadius:4, padding:'1px 6px', fontWeight:700}}>EDITADO</span>
                  )}
                </span>
                <span className="abatimento-value" style={{color:'var(--warn)', display:'flex', alignItems:'center', gap:6}}>
                  − {fmt(volumeAbatimento)} kg
                  {isEspecial135612 && temAbatimento && (
                    <button
                      title="Editar valor do abatimento"
                      onClick={() => setEditandoAbatimento(v => !v)}
                      style={{background:'none', border:'1px solid var(--warn)', borderRadius:4, color:'var(--warn)', cursor:'pointer', fontSize:11, padding:'1px 6px', lineHeight:1.4}}
                    >✏</button>
                  )}
                  {isEspecial135612 && abatimentoOverride != null && (
                    <button
                      title="Restaurar cálculo automático"
                      onClick={() => { setAbatimentoOverride(null); setEditandoAbatimento(false) }}
                      style={{background:'none', border:'1px solid var(--accent-2)', borderRadius:4, color:'var(--accent-2)', cursor:'pointer', fontSize:10, padding:'1px 5px', lineHeight:1.4}}
                    >↺</button>
                  )}
                </span>
              </div>
            )}
            {/* Campo de edição inline do abatimento */}
            {isEspecial135612 && temAbatimento && editandoAbatimento && (
              <div style={{display:'flex', alignItems:'center', gap:8, padding:'8px 0 4px', borderTop:'1px dashed var(--border)'}}>
                <span style={{fontSize:12, color:'var(--text-dim)', whiteSpace:'nowrap'}}>Abatimento (kg):</span>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  style={{width:110, padding:'4px 8px', borderRadius:6, border:'1px solid var(--warn)', background:'var(--bg-2)', color:'var(--text)', fontSize:13}}
                  value={abatimentoOverride ?? volumeAbatimentoBase.toFixed(3)}
                  onChange={e => setAbatimentoOverride(parseFloat(e.target.value) || 0)}
                />
                <span style={{fontSize:12, color:'var(--text-dim)'}}>kg</span>
                <button
                  className="btn btn-sm"
                  style={{background:'var(--accent)', color:'#fff', fontSize:11, padding:'3px 10px'}}
                  onClick={() => setEditandoAbatimento(false)}
                >OK</button>
                <span style={{fontSize:11, color:'var(--text-dim)'}}>
                  Auto: {fmt(volumeAbatimentoBase)} kg
                </span>
              </div>
            )}
            <div style={{borderTop:'1px solid var(--border)', paddingTop:8, marginTop:4}}>
              <div className="abatimento-row">
                <span className="abatimento-label" style={{fontWeight:700}}>
                  Volume a Debitar do Estoque
                </span>
                <span className="abatimento-value highlight">{fmt(volumeAbatido)}{form.tipo_saida !== 'insumo' ? ' kg' : ''}</span>
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
                      const novoLiq = temAbatimento
                        ? totalSaldo / (1 - percAbat)
                        : totalSaldo
                      set('volume_liquido_kg', novoLiq.toFixed(4))
                    }}
                  >
                    ↓ Ajustar para Zerar Saldo ({fmt(temAbatimento ? totalSaldo / (1 - percAbat) : totalSaldo)} kg)
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

      {/* ── ABA: MULTI-SAÍDAS ── */}
      {aba === 'multi' && (
        <div className="card" style={{marginBottom:24}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
            <div className="card-title" style={{margin:0}}>📋 Multi-saídas — 1 romaneio, N materiais</div>
            <button className="btn btn-ghost btn-sm" onClick={resetMulti}>↺ Limpar</button>
          </div>

          {/* Cabeçalho do romaneio */}
          <div className="form-grid-4" style={{marginBottom:16}}>
            <div className="form-group">
              <label className="form-label">Romaneio Microdata *</label>
              <input className="form-input" placeholder="Ex: 122041"
                value={multiForm.romaneio_microdata}
                onChange={e => setMultiForm(f => ({...f, romaneio_microdata: e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="form-label">Tipo de Saída *</label>
              <select className="form-select" value={multiForm.tipo_saida}
                onChange={e => setMultiForm(f => ({...f, tipo_saida: e.target.value}))}>
                <option value="">Selecione...</option>
                {TIPOS_SAIDA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Lote Acabado</label>
              <input className="form-input" placeholder="Opcional"
                value={multiForm.lote_acabado}
                onChange={e => setMultiForm(f => ({...f, lote_acabado: e.target.value}))} />
            </div>
          </div>

          {multiForm.tipo_saida && TIPOS_COM_ABATIMENTO.includes(multiForm.tipo_saida) && (
            <div style={{background:'rgba(255,180,0,0.08)', border:'1px solid var(--warn)', borderRadius:8, padding:'8px 12px', fontSize:12, color:'var(--warn)', marginBottom:14}}>
              ⚠️ Abatimento de {percentualBase != null ? `${(percentualBase*100).toFixed(1).replace('.',',')}%` : '1,5%'} será aplicado em cada item.
            </div>
          )}

          {/* Tabela de linhas */}
          {!multiResultado && (
            <>
              <div style={{overflowX:'auto', marginBottom:12}}>
                <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
                  <thead>
                    <tr style={{background:'rgba(255,255,255,0.04)'}}>
                      <th style={{padding:'8px 10px', width:36, textAlign:'center'}}>
                        <input type="checkbox"
                          checked={multiLinhas.every(l => l.incluir)}
                          onChange={e => setMultiLinhas(ls => ls.map(l => ({...l, incluir: e.target.checked})))} />
                      </th>
                      <th style={{padding:'8px 10px', textAlign:'left', color:'var(--text-dim)', fontWeight:600}}>Cód. Material *</th>
                      <th style={{padding:'8px 10px', textAlign:'left', color:'var(--text-dim)', fontWeight:600}}>
                        {multiForm.tipo_saida === 'insumo' ? 'Lote POY' : 'Lote POY *'}
                      </th>
                      <th style={{padding:'8px 10px', textAlign:'right', color:'var(--text-dim)', fontWeight:600}}>
                        {multiForm.tipo_saida === 'insumo' ? 'Volume/Qtd *' : 'Vol. Líq. (kg) *'}
                      </th>
                      <th style={{padding:'8px 10px', textAlign:'right', color:'var(--text-dim)', fontWeight:600}}>Saldo Disp.</th>
                      <th style={{padding:'8px 10px', textAlign:'right', color:'var(--text-dim)', fontWeight:600}}>Vol. Final</th>
                      <th style={{width:32}}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {multiLinhas.map(l => {
                      const vol      = parseFloat(l.volume) || 0
                      const saldo    = l.codigo_material ? getSaldoMultiLinha(l) : null
                      const volFinal = vol > 0 ? calcularVolumeAbatido(vol, multiForm.tipo_saida, l.codigo_material, percentualBase) : 0
                      const excede   = saldo != null && vol > 0 && volFinal > saldo + 0.01
                      const isInsumo = multiForm.tipo_saida === 'insumo'
                      return (
                        <tr key={l._id} style={{borderBottom:'1px solid rgba(255,255,255,0.05)', opacity: l.incluir ? 1 : 0.45, background: excede ? 'rgba(255,60,60,0.06)' : undefined}}>
                          <td style={{padding:'6px 10px', textAlign:'center'}}>
                            <input type="checkbox" checked={l.incluir} onChange={e => setMultiLinha(l._id, 'incluir', e.target.checked)} />
                          </td>
                          <td style={{padding:'6px 10px'}}>
                            <input className="form-input" style={{width:120, fontFamily:'monospace'}} placeholder="Ex: 21986"
                              value={l.codigo_material} disabled={!l.incluir}
                              onChange={e => setMultiLinha(l._id, 'codigo_material', e.target.value)} />
                          </td>
                          <td style={{padding:'6px 10px'}}>
                            <input className="form-input" style={{width:90, fontFamily:'monospace'}} placeholder={isInsumo ? 'Opcional' : 'Ex: 37553'}
                              value={l.lote_poy} disabled={!l.incluir}
                              onChange={e => setMultiLinha(l._id, 'lote_poy', e.target.value)} />
                          </td>
                          <td style={{padding:'6px 10px'}}>
                            <input className="form-input" type="number" step="0.001" min="0"
                              style={{width:110, textAlign:'right', fontFamily:'monospace', borderColor: excede ? 'var(--danger)' : undefined}}
                              placeholder="0,000" value={l.volume} disabled={!l.incluir}
                              onChange={e => setMultiLinha(l._id, 'volume', e.target.value)} />
                          </td>
                          <td style={{padding:'8px 10px', textAlign:'right', fontFamily:'monospace', color: saldo != null && saldo <= 0.01 ? 'var(--danger)' : 'var(--accent-2)', fontWeight:600, fontSize:12}}>
                            {saldo != null ? (
                              <>
                                {fmt(saldo)}{!isInsumo ? ' kg' : ''}
                                {saldo > 0.01 && vol === 0 && (
                                  <button title="Usar saldo total" style={{marginLeft:4, background:'none', border:'none', cursor:'pointer', fontSize:10, color:'var(--accent)', padding:0}}
                                    onClick={() => {
                                      const perc = getPercentualAbatimento(l.codigo_material, percentualBase)
                                      const temA = TIPOS_COM_ABATIMENTO.includes(multiForm.tipo_saida)
                                      setMultiLinha(l._id, 'volume', temA ? (saldo / (1 - perc)).toFixed(3) : saldo.toFixed(3))
                                    }}>↓max</button>
                                )}
                              </>
                            ) : '—'}
                          </td>
                          <td style={{padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontWeight:600, color: excede ? 'var(--danger)' : vol > 0 ? 'var(--accent)' : 'var(--text-dim)', fontSize:12}}>
                            {vol > 0 ? `${fmt(volFinal)}${!isInsumo ? ' kg' : ''}` : '—'}
                            {excede && <div style={{fontSize:10, color:'var(--danger)'}}>excede saldo</div>}
                          </td>
                          <td style={{padding:'6px 8px', textAlign:'center'}}>
                            {multiLinhas.length > 1 && (
                              <button onClick={() => removeMultiLinha(l._id)}
                                style={{background:'none', border:'none', cursor:'pointer', color:'var(--danger)', fontSize:16, padding:0}}>✕</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{borderTop:'2px solid var(--border)', background:'rgba(255,255,255,0.03)'}}>
                      <td colSpan={3} style={{padding:'8px 10px'}}>
                        <button className="btn btn-ghost btn-sm" onClick={addMultiLinha} style={{fontSize:12}}>+ Adicionar material</button>
                      </td>
                      <td style={{padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontWeight:700, color:'var(--text-dim)', fontSize:12}}>
                        {fmt(multiLinhas.filter(l=>l.incluir).reduce((a,l) => a + (parseFloat(l.volume)||0), 0))}
                        {multiForm.tipo_saida !== 'insumo' ? ' kg' : ''}
                      </td>
                      <td />
                      <td style={{padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontWeight:700, color:'var(--accent)', fontSize:12}}>
                        {fmt(multiLinhas.filter(l=>l.incluir).reduce((a,l) => a + calcularVolumeAbatido(parseFloat(l.volume)||0, multiForm.tipo_saida, l.codigo_material, percentualBase), 0))}
                        {multiForm.tipo_saida !== 'insumo' ? ' kg' : ''}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div style={{display:'flex', justifyContent:'flex-end', gap:10}}>
                <button className="btn btn-ghost" onClick={resetMulti}>↺ Recomeçar</button>
                <button className="btn btn-primary" onClick={handleGerarMulti}
                  disabled={multiLoading || !multiForm.romaneio_microdata || !multiForm.tipo_saida ||
                    multiLinhas.filter(l=>l.incluir && l.codigo_material && parseFloat(l.volume)>0).length === 0}>
                  {multiLoading ? '⏳ Registrando...' : `⚡ Gerar Romaneio (${multiLinhas.filter(l=>l.incluir && l.codigo_material && parseFloat(l.volume)>0).length} itens)`}
                </button>
              </div>
            </>
          )}

          {/* Resultado */}
          {multiResultado && (
            <div style={{marginTop:8, background:'rgba(0,195,100,0.08)', border:'1px solid var(--accent-2)', borderRadius:10, padding:16}}>
              <div style={{fontWeight:700, color:'var(--accent-2)', fontSize:14, marginBottom:12}}>
                ✅ Romaneio {multiForm.romaneio_microdata} — {multiResultado.itens.length} baixa(s) registrada(s)!
              </div>
              <div style={{overflowX:'auto', marginBottom:12}}>
                <table style={{width:'100%', borderCollapse:'collapse', fontSize:13}}>
                  <thead>
                    <tr style={{background:'rgba(255,255,255,0.04)'}}>
                      <th style={{padding:'6px 10px', textAlign:'left', color:'var(--text-dim)'}}>Cód. Material</th>
                      <th style={{padding:'6px 10px', textAlign:'left', color:'var(--text-dim)'}}>Lote POY</th>
                      <th style={{padding:'6px 10px', textAlign:'left', color:'var(--text-dim)'}}>Descrição</th>
                      <th style={{padding:'6px 10px', textAlign:'right', color:'var(--text-dim)'}}>Volume</th>
                      <th style={{padding:'6px 10px', textAlign:'right', color:'var(--text-dim)'}}>Debitado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {multiResultado.itens.map((it, i) => (
                      <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                        <td style={{padding:'6px 10px', fontFamily:'monospace', fontWeight:700}}>{it.codigo_material}</td>
                        <td style={{padding:'6px 10px', fontFamily:'monospace'}}>{it.lote_poy || '—'}</td>
                        <td style={{padding:'6px 10px', fontSize:12, color:'var(--text-dim)'}}>{it.descricao_material || '—'}</td>
                        <td style={{padding:'6px 10px', textAlign:'right', fontFamily:'monospace'}}>{fmt(it.volume_liquido_kg)}</td>
                        <td style={{padding:'6px 10px', textAlign:'right', fontFamily:'monospace', fontWeight:700, color:'var(--accent)'}}>{fmt(it.volume_abatido_kg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {multiResultado.erros?.length > 0 && (
                <div style={{fontSize:12, color:'var(--danger)', marginBottom:10}}>
                  ⚠️ Erros: {multiResultado.erros.map(e => `${e.material}: ${e.erro}`).join(' | ')}
                </div>
              )}
              <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                <button className="btn btn-primary btn-sm" onClick={() => gerarMultiSaidaPDF({
                  romaneio_microdata: multiForm.romaneio_microdata,
                  tipo_saida:         multiForm.tipo_saida,
                  lote_acabado:       multiForm.lote_acabado,
                  itens:              multiResultado.itens,
                  criado_em:          new Date().toISOString(),
                }, config)}>
                  📄 Baixar Romaneio PDF
                </button>
                <button className="btn btn-ghost btn-sm" onClick={resetMulti}>Nova multi-saída</button>
              </div>
            </div>
          )}
        </div>
      )} {/* fim aba multi */}
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
                          onClick={() => {
                            const todasAloc = s.alocacao_saida || []
                            const alocPrinc = todasAloc.filter(a => !a.codigo_material_companion)
                            const alocComp  = todasAloc.filter(a =>  a.codigo_material_companion)
                            handleGerarPDF(s, alocPrinc, alocComp)
                          }}>📄</button>
                        {!readOnly && (
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
          previewsCompanion={confirmacao.previewsCompanion}
          onConfirm={handleConfirmar}
          onCancel={() => setConfirmacao(null)}
          loading={loading}
          percentualBase={percentualBase}
        />
      )}

      {ultimaSaida && (
        <SucessoModal
          ultimaSaida={ultimaSaida}
          onClose={() => setUltimaSaida(null)}
          onPDF={() => handleGerarPDF(ultimaSaida.saida, ultimaSaida.alocacoes, ultimaSaida.alocacoesCompanion || [])}
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
