import { useEffect, useState, useMemo } from 'react'
import {
  listarSaidas, criarSaida, listarNFsEntrada, previewFIFO,
  TIPOS_SAIDA, TIPOS_COM_ABATIMENTO, PERCENTUAL_ABATIMENTO,
  calcularVolumeAbatido, gerarRomaneioPDF, exportarExcel, proximoNumeroRomaneio, carregarConfig
} from '../lib/faconagem'
import { useAuth } from '../lib/AuthContext'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

function Toast({ toasts }) {
  return <div className="toast-container">{toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
}

const EMPTY_FORM = { romaneio_microdata: '', codigo_produto: '', lote_produto: '', tipo_saida: '', volume_bruto_kg: '' }

function tipoBadge(tipo) {
  const map = { faturamento:'badge-blue', sucata:'badge-danger', estopa:'badge-warn', dev_qualidade:'badge-green', dev_processo:'badge-green', dev_final_campanha:'badge-green' }
  const label = TIPOS_SAIDA.find(t => t.value === tipo)?.label || tipo
  return <span className={`badge ${map[tipo] || 'badge-blue'}`}>{label}</span>
}

function fmt(n) { return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) }

// ── Modal de Confirmação FIFO ─────────────────────────────────────
function ConfirmacaoModal({ form, preview, onConfirm, onCancel, loading }) {
  const volumeBruto  = parseFloat(form.volume_bruto_kg) || 0
  const temAbat      = TIPOS_COM_ABATIMENTO.includes(form.tipo_saida)
  const volumeAbat   = calcularVolumeAbatido(volumeBruto, form.tipo_saida)
  const tipoLbl      = TIPOS_SAIDA.find(t => t.value === form.tipo_saida)?.label || ''

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{maxWidth:560}} onClick={e => e.stopPropagation()}>
        <div className="modal-title">⚡ Confirmar Saída</div>

        <div className="abatimento-box" style={{marginBottom:16}}>
          <div className="abatimento-row">
            <span className="abatimento-label">Romaneio Microdata</span>
            <span className="abatimento-value">{form.romaneio_microdata}</span>
          </div>
          <div className="abatimento-row">
            <span className="abatimento-label">Tipo</span>
            <span>{tipoBadge(form.tipo_saida)}</span>
          </div>
          <div className="abatimento-row">
            <span className="abatimento-label">Volume Bruto</span>
            <span className="abatimento-value">{fmt(volumeBruto)} kg</span>
          </div>
          {temAbat && (
            <div className="abatimento-row">
              <span className="abatimento-label">Abatimento 1,5% ({tipoLbl})</span>
              <span className="abatimento-value" style={{color:'var(--warn)'}}>− {fmt(volumeBruto - volumeAbat)} kg</span>
            </div>
          )}
          <div style={{borderTop:'1px solid var(--border)', paddingTop:8, marginTop:4}}>
            <div className="abatimento-row">
              <span className="abatimento-label" style={{fontWeight:700}}>Volume Final a Debitar</span>
              <span className="abatimento-value highlight">{fmt(volumeAbat)} kg</span>
            </div>
          </div>
        </div>

        <div style={{fontSize:13, fontWeight:600, color:'var(--blue-200)', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.04em'}}>
          Será debitado das NFs (FIFO):
        </div>

        <div className="table-wrap" style={{marginBottom:4}}>
          <table>
            <thead><tr><th>NF</th><th>Emissão</th><th className="td-right">Saldo Atual</th><th className="td-right">Será Debitado</th><th className="td-right">Saldo Restante</th></tr></thead>
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

// ── Modal de Sucesso / Romaneio ───────────────────────────────────
function SucesModal({ ultimaSaida, onClose, onPDF }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{maxWidth:520}} onClick={e => e.stopPropagation()}>
        <div className="modal-title" style={{color:'var(--accent-2)'}}>✓ Saída Registrada com Sucesso!</div>

        <div className="abatimento-box" style={{marginBottom:16}}>
          <div className="abatimento-row">
            <span className="abatimento-label">Romaneio Microdata</span>
            <span className="abatimento-value">{ultimaSaida.saida.romaneio_microdata}</span>
          </div>
          <div className="abatimento-row">
            <span className="abatimento-label">Tipo</span>
            <span>{tipoBadge(ultimaSaida.saida.tipo_saida)}</span>
          </div>
          <div className="abatimento-row">
            <span className="abatimento-label">Volume Bruto</span>
            <span className="abatimento-value">{fmt(ultimaSaida.saida.volume_bruto_kg)} kg</span>
          </div>
          <div className="abatimento-row">
            <span className="abatimento-label">Volume Final</span>
            <span className="abatimento-value highlight">{fmt(ultimaSaida.saida.volume_abatido_kg)} kg</span>
          </div>
        </div>

        <div style={{fontSize:13, fontWeight:600, color:'var(--blue-200)', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.04em'}}>Alocações FIFO</div>
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
          <button className="btn btn-success" onClick={onPDF}>📄 Gerar Romaneio PDF</button>
        </div>
      </div>
    </div>
  )
}

// ── Página Principal ──────────────────────────────────────────────
export default function SaidaPage() {
  const { user } = useAuth()
  const [saidas, setSaidas]         = useState([])
  const [nfs, setNfs]               = useState([])
  const [form, setForm]             = useState(EMPTY_FORM)
  const [loading, setLoading]       = useState(false)
  const [loadingList, setLoadingList] = useState(true)
  const [toasts, setToasts]         = useState([])
  const [ultimaSaida, setUltimaSaida] = useState(null)
  const [confirmacao, setConfirmacao] = useState(null) // { preview }
  const [config, setConfig]         = useState({})

  // ── Filtros ──
  const [fBusca, setFBusca]         = useState('')
  const [fTipo, setFTipo]           = useState('')
  const [fDe, setFDe]               = useState('')
  const [fAte, setFAte]             = useState('')

  const toast = (msg, type = 'success') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }

  const load = () => {
    setLoadingList(true)
    Promise.all([listarSaidas(), listarNFsEntrada()])
      .then(([s, n]) => { setSaidas(s); setNfs(n) })
      .catch(e => toast(e.message, 'error'))
      .finally(() => setLoadingList(false))
  }

  useEffect(() => {
    load()
    carregarConfig().then(setConfig)
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const volumeBruto     = parseFloat(form.volume_bruto_kg) || 0
  const temAbatimento   = TIPOS_COM_ABATIMENTO.includes(form.tipo_saida)
  const volumeAbatido   = calcularVolumeAbatido(volumeBruto, form.tipo_saida)
  const valorAbatimento = volumeBruto - volumeAbatido
  const totalSaldo      = nfs.reduce((a, n) => a + Number(n.volume_saldo_kg), 0)
  const saldoInsuficiente = volumeAbatido > totalSaldo + 0.01

  // Gerar número automático de romaneio ao entrar na página
  const handleAutoRomaneio = async () => {
    const num = await proximoNumeroRomaneio()
    set('romaneio_microdata', num)
    toast(`Romaneio gerado: ${num}`)
  }

  const handlePreConfirm = async () => {
    if (!form.romaneio_microdata || !form.codigo_produto || !form.lote_produto || !form.tipo_saida || !form.volume_bruto_kg) {
      toast('Preencha todos os campos.', 'error'); return
    }
    if (saldoInsuficiente) { toast(`Saldo insuficiente! Disponível: ${fmt(totalSaldo)} kg`, 'error'); return }
    const { preview } = await previewFIFO(volumeAbatido)
    setConfirmacao({ preview })
  }

  const handleConfirmar = async () => {
    setLoading(true)
    try {
      const resultado = await criarSaida({
        romaneio_microdata: form.romaneio_microdata.trim(),
        codigo_produto:     form.codigo_produto.trim(),
        lote_produto:       form.lote_produto.trim(),
        tipo_saida:         form.tipo_saida,
        volume_bruto_kg:    volumeBruto,
      }, user)
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

  const handleExportar = () => {
    exportarExcel(nfs, saidas)
    toast('Exportação concluída!')
  }

  // ── Filtros aplicados ──
  const saidasFiltradas = useMemo(() => {
    return saidas.filter(s => {
      const txt = fBusca.toLowerCase()
      if (txt && !s.romaneio_microdata?.toLowerCase().includes(txt) &&
                 !s.lote_produto?.toLowerCase().includes(txt) &&
                 !s.codigo_produto?.toLowerCase().includes(txt)) return false
      if (fTipo && s.tipo_saida !== fTipo) return false
      if (fDe) {
        const data = new Date(s.criado_em)
        if (data < new Date(fDe + 'T00:00:00')) return false
      }
      if (fAte) {
        const data = new Date(s.criado_em)
        if (data > new Date(fAte + 'T23:59:59')) return false
      }
      return true
    })
  }, [saidas, fBusca, fTipo, fDe, fAte])

  const temFiltro = fBusca || fTipo || fDe || fAte
  const limparFiltros = () => { setFBusca(''); setFTipo(''); setFDe(''); setFAte('') }

  const totalFiltrado    = saidasFiltradas.reduce((a, s) => a + Number(s.volume_abatido_kg), 0)
  const totalBrutoFiltrado = saidasFiltradas.reduce((a, s) => a + Number(s.volume_bruto_kg), 0)

  return (
    <div>
      <div className="page-header" style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12}}>
        <div>
          <div className="page-title"><span>↑</span> Saída de Material</div>
          <div className="page-sub">Registro de saídas com abatimento e alocação FIFO</div>
        </div>
        <button className="btn btn-ghost" onClick={handleExportar} title="Exportar Excel com NFs e Saídas">
          📊 Exportar Excel
        </button>
      </div>

      {/* Formulário */}
      <div className="card" style={{marginBottom:24}}>
        <div className="card-title">Registrar Nova Saída</div>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Romaneio Microdata *</label>
            <div style={{display:'flex', gap:8}}>
              <input type="text" className="form-input" placeholder="Ex: 122041" value={form.romaneio_microdata} onChange={e => set('romaneio_microdata', e.target.value)} />
              <button className="btn btn-ghost btn-sm" style={{whiteSpace:'nowrap'}} title="Gerar número sequencial automático" onClick={handleAutoRomaneio}>
                # Auto
              </button>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Código do Produto *</label>
            <input type="text" className="form-input" placeholder="Ex: 140911" value={form.codigo_produto} onChange={e => set('codigo_produto', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Lote do Produto *</label>
            <input type="text" className="form-input" placeholder="Ex: 4527" value={form.lote_produto} onChange={e => set('lote_produto', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Tipo de Saída *</label>
            <select className="form-select" value={form.tipo_saida} onChange={e => set('tipo_saida', e.target.value)}>
              <option value="">Selecione...</option>
              {TIPOS_SAIDA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Volume Bruto (kg) *</label>
            <input type="number" step="0.0001" min="0" className="form-input" placeholder="0,0000" value={form.volume_bruto_kg} onChange={e => set('volume_bruto_kg', e.target.value)} />
          </div>
        </div>

        {volumeBruto > 0 && form.tipo_saida && (
          <div className="abatimento-box" style={{marginTop:16}}>
            <div className="abatimento-row">
              <span className="abatimento-label">Volume Bruto</span>
              <span className="abatimento-value">{fmt(volumeBruto)} kg</span>
            </div>
            {temAbatimento && (
              <div className="abatimento-row">
                <span className="abatimento-label">Abatimento 1,5% <span className="abatimento-badge">{TIPOS_SAIDA.find(t=>t.value===form.tipo_saida)?.label}</span></span>
                <span className="abatimento-value" style={{color:'var(--warn)'}}>− {fmt(valorAbatimento)} kg</span>
              </div>
            )}
            <div style={{borderTop:'1px solid var(--border)', paddingTop:8, marginTop:4}}>
              <div className="abatimento-row">
                <span className="abatimento-label" style={{fontWeight:700}}>{temAbatimento ? 'Volume Final (com abatimento)' : 'Volume Final'}</span>
                <span className="abatimento-value highlight">{fmt(volumeAbatido)} kg</span>
              </div>
            </div>
            {saldoInsuficiente && (
              <div style={{marginTop:8, padding:'8px 12px', background:'rgba(255,77,109,0.1)', borderRadius:6, color:'var(--danger)', fontSize:12}}>
                ⚠ Saldo insuficiente. Disponível: <strong>{fmt(totalSaldo)} kg</strong>
              </div>
            )}
          </div>
        )}

        <div style={{display:'flex', justifyContent:'flex-end', marginTop:20}}>
          <button className="btn btn-primary" onClick={handlePreConfirm} disabled={loading || saldoInsuficiente || !form.tipo_saida || !volumeBruto}>
            Revisar e Confirmar →
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="card" style={{marginBottom:16}}>
        <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom: temFiltro ? 12 : 0}}>
          <div className="card-title" style={{margin:0, flex:1, minWidth:140}}>Histórico de Saídas</div>
          <input className="form-input" style={{maxWidth:200}} placeholder="🔍 Romaneio, lote..." value={fBusca} onChange={e => setFBusca(e.target.value)} />
          <select className="form-select" style={{maxWidth:180}} value={fTipo} onChange={e => setFTipo(e.target.value)}>
            <option value="">Todos os tipos</option>
            {TIPOS_SAIDA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input type="date" className="form-input" style={{maxWidth:150}} value={fDe} onChange={e => setFDe(e.target.value)} title="De" />
          <input type="date" className="form-input" style={{maxWidth:150}} value={fAte} onChange={e => setFAte(e.target.value)} title="Até" />
          {temFiltro && <button className="btn btn-ghost btn-sm" onClick={limparFiltros}>✕ Limpar</button>}
        </div>

        {temFiltro && saidasFiltradas.length > 0 && (
          <div style={{display:'flex', gap:16, padding:'8px 12px', background:'rgba(0,195,255,0.05)', borderRadius:6, fontSize:12, color:'var(--text-dim)', flexWrap:'wrap'}}>
            <span>📋 <strong style={{color:'var(--text)'}}>{saidasFiltradas.length}</strong> saída{saidasFiltradas.length !== 1 ? 's' : ''}</span>
            <span>📦 Bruto: <strong style={{color:'var(--text)'}}>{fmt(totalBrutoFiltrado)} kg</strong></span>
            <span>✓ Final: <strong style={{color:'var(--accent)'}}>{fmt(totalFiltrado)} kg</strong></span>
          </div>
        )}
      </div>

      {/* Tabela */}
      <div className="card">
        {loadingList ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Romaneio</th>
                  <th>Cód. Produto</th>
                  <th>Lote</th>
                  <th>Tipo</th>
                  <th className="td-right">Bruto (kg)</th>
                  <th className="td-right">Final (kg)</th>
                  <th>Data</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {saidasFiltradas.length === 0 && (
                  <tr><td colSpan={8}><div className="empty">
                    <div className="empty-icon">{temFiltro ? '🔍' : '📋'}</div>
                    <div className="empty-text">{temFiltro ? 'Nenhuma saída encontrada com esses filtros.' : 'Nenhuma saída registrada ainda.'}</div>
                  </div></td></tr>
                )}
                {saidasFiltradas.map(s => (
                  <tr key={s.id}>
                    <td className="td-mono" style={{fontWeight:600}}>{s.romaneio_microdata}</td>
                    <td>{s.codigo_produto}</td>
                    <td>{s.lote_produto}</td>
                    <td>{tipoBadge(s.tipo_saida)}</td>
                    <td className="td-right td-mono">{fmt(s.volume_bruto_kg)}</td>
                    <td className="td-right td-mono" style={{color:'var(--accent)', fontWeight:600}}>{fmt(s.volume_abatido_kg)}</td>
                    <td style={{fontSize:12, color:'var(--text-dim)'}}>
                      {s.criado_em ? format(new Date(s.criado_em), 'dd/MM/yyyy HH:mm') : '—'}
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" title="Gerar Romaneio PDF" onClick={() => handleGerarPDF(s, s.alocacao_saida || [])}>
                        📄
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de confirmação */}
      {confirmacao && (
        <ConfirmacaoModal
          form={form}
          preview={confirmacao.preview}
          onConfirm={handleConfirmar}
          onCancel={() => setConfirmacao(null)}
          loading={loading}
        />
      )}

      {/* Modal de sucesso */}
      {ultimaSaida && (
        <SucesModal
          ultimaSaida={ultimaSaida}
          onClose={() => setUltimaSaida(null)}
          onPDF={() => handleGerarPDF(ultimaSaida.saida, ultimaSaida.alocacoes)}
        />
      )}

      <Toast toasts={toasts} />
    </div>
  )
}
