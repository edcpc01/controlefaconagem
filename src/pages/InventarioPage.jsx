import { useEffect, useState, useMemo } from 'react'
import { listarNFsEntrada, listarInventarios, salvarInventario, gerarInventarioPDF } from '../lib/faconagem'
import { useUser } from '../lib/UserContext'
import { useOperacao } from '../lib/OperacaoContext'
import { useAuth } from '../lib/AuthContext'

const fmt = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function statusDiverg(pct) {
  const abs = Math.abs(pct)
  if (abs < 0.5)  return { label: '✅ OK',      color: 'var(--accent-2)', bg: 'rgba(0,195,100,0.08)' }
  if (abs < 2)    return { label: '⚠️ Atenção', color: 'var(--warn)',     bg: 'rgba(255,180,0,0.08)' }
  return              { label: '🚨 Crítico',  color: 'var(--danger)',   bg: 'rgba(255,60,60,0.08)' }
}

function Toast({ toasts }) {
  return <div className="toast-container">{toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
}

export default function InventarioPage() {
  const { unidadeAtiva } = useUser() || {}
  const { colecoes, operacaoAtiva } = useOperacao() || {}
  const { user } = useAuth()

  const [nfs,        setNfs]        = useState([])
  const [loading,    setLoading]    = useState(true)
  const [salvando,   setSalvando]   = useState(false)
  const [toasts,     setToasts]     = useState([])
  const [historico,  setHistorico]  = useState([])
  const [abaAtiva,   setAbaAtiva]   = useState('novo') // 'novo' | 'historico'
  const [contagens,  setContagens]  = useState({})     // { lote: valorStr }
  const [salvo,      setSalvo]      = useState(false)

  const toast = (msg, type = 'success') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }

  useEffect(() => {
    setLoading(true)
    Promise.all([
      listarNFsEntrada(unidadeAtiva || '', colecoes),
      listarInventarios(unidadeAtiva || '', colecoes),
    ]).then(([n, h]) => {
      setNfs(n)
      setHistorico(h)
    }).catch(e => toast(e.message, 'error'))
      .finally(() => setLoading(false))
  }, [unidadeAtiva, operacaoAtiva])

  // Saldo teórico agrupado por lote
  const saldosPorLote = useMemo(() => {
    const mapa = {}
    for (const nf of nfs) {
      const lote = nf.lote || '(sem lote)'
      if (!mapa[lote]) mapa[lote] = { lote, saldo_teorico: 0, nfs: [] }
      mapa[lote].saldo_teorico += Number(nf.volume_saldo_kg || 0)
      mapa[lote].nfs.push(nf)
    }
    return Object.values(mapa)
      .filter(l => l.saldo_teorico > 0.01)
      .sort((a, b) => b.saldo_teorico - a.saldo_teorico)
  }, [nfs])

  // Linhas com divergência calculada
  const linhas = useMemo(() => {
    return saldosPorLote.map(l => {
      const contagem_kg    = parseFloat(contagens[l.lote] || '') || 0
      const divergencia_kg = contagem_kg - l.saldo_teorico
      const divergencia_pct = l.saldo_teorico > 0 ? (divergencia_kg / l.saldo_teorico) * 100 : 0
      return { ...l, contagem_kg, divergencia_kg, divergencia_pct }
    })
  }, [saldosPorLote, contagens])

  const totalTeorico = linhas.reduce((a, l) => a + l.saldo_teorico, 0)
  const totalFisico  = linhas.reduce((a, l) => a + l.contagem_kg, 0)
  const totalDiverg  = totalFisico - totalTeorico
  const linhesPreenchidas = linhas.filter(l => contagens[l.lote] !== undefined && contagens[l.lote] !== '')
  const temDivergencia   = linhas.some(l => Math.abs(l.divergencia_pct) >= 0.5)

  const handleSalvar = async () => {
    if (linhesPreenchidas.length === 0) { toast('Preencha ao menos uma contagem física.', 'error'); return }
    setSalvando(true)
    try {
      await salvarInventario(unidadeAtiva || '', linhesPreenchidas, user, colecoes)
      setSalvo(true)
      toast('✅ Inventário salvo com sucesso!')
      const h = await listarInventarios(unidadeAtiva || '', colecoes)
      setHistorico(h)
    } catch (e) {
      toast(e.message || 'Erro ao salvar inventário.', 'error')
    } finally {
      setSalvando(false)
    }
  }

  const handlePDF = () => {
    gerarInventarioPDF(
      linhesPreenchidas.length > 0 ? linhesPreenchidas : linhas,
      unidadeAtiva || '',
      new Date().toLocaleDateString('pt-BR')
    )
    toast('PDF gerado!')
  }

  const handlePreencherTodos = () => {
    const novos = {}
    for (const l of saldosPorLote) novos[l.lote] = l.saldo_teorico.toFixed(3)
    setContagens(novos)
  }

  const handleLimpar = () => { setContagens({}); setSalvo(false) }

  if (loading) return <div className="loading"><div className="spinner" /><div>Carregando...</div></div>

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Inventário <span>Físico</span></div>
        <div className="page-sub">Compare o estoque físico com o saldo teórico do sistema</div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, marginBottom:20, borderBottom:'1px solid var(--border)' }}>
        {[{k:'novo', label:'📋 Novo Inventário'}, {k:'historico', label:`🕓 Histórico (${historico.length})`}].map(t => (
          <button key={t.k} onClick={() => setAbaAtiva(t.k)} style={{
            padding:'10px 20px', background:'none', border:'none', cursor:'pointer', fontSize:13, fontWeight:600,
            color: abaAtiva === t.k ? 'var(--accent)' : 'var(--text-dim)',
            borderBottom: abaAtiva === t.k ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -1,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── ABA NOVO INVENTÁRIO ── */}
      {abaAtiva === 'novo' && (
        <>
          {/* Resumo */}
          {linhesPreenchidas.length > 0 && (
            <div className="stats-grid" style={{ marginBottom: 20 }}>
              <div className="stat-card">
                <div className="stat-label">Saldo Teórico</div>
                <div className="stat-value">{fmt(totalTeorico)}</div>
                <div className="stat-unit">kg no sistema</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Contagem Física</div>
                <div className="stat-value" style={{ color:'var(--accent)' }}>{fmt(totalFisico)}</div>
                <div className="stat-unit">kg contados</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Divergência Total</div>
                <div className="stat-value" style={{ color: Math.abs(totalDiverg) < 0.01 ? 'var(--accent-2)' : totalDiverg < 0 ? 'var(--danger)' : 'var(--warn)' }}>
                  {totalDiverg >= 0 ? '+' : ''}{fmt(totalDiverg)}
                </div>
                <div className="stat-unit">kg ({totalTeorico > 0 ? ((totalDiverg/totalTeorico)*100).toFixed(2) : '0.00'}%)</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Lotes com Divergência</div>
                <div className="stat-value" style={{ color: temDivergencia ? 'var(--warn)' : 'var(--accent-2)' }}>
                  {linhas.filter(l => contagens[l.lote] !== undefined && Math.abs(l.divergencia_pct) >= 0.5).length}
                </div>
                <div className="stat-unit">de {linhesPreenchidas.length} contados</div>
              </div>
            </div>
          )}

          <div className="card">
            {/* Toolbar */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:10 }}>
              <div className="card-title" style={{ margin:0 }}>
                Contagem por Lote POY
                <span style={{ fontSize:12, color:'var(--text-dim)', fontWeight:400, marginLeft:10 }}>
                  {saldosPorLote.length} lote{saldosPorLote.length !== 1 ? 's' : ''} com saldo
                </span>
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <button className="btn btn-ghost btn-sm" onClick={handlePreencherTodos} title="Preenche todos com o saldo teórico (sem divergência)">
                  ↓ Preencher com teórico
                </button>
                <button className="btn btn-ghost btn-sm" onClick={handleLimpar}>↺ Limpar</button>
                {linhesPreenchidas.length > 0 && (
                  <button className="btn btn-ghost btn-sm" onClick={handlePDF}>📄 PDF</button>
                )}
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSalvar}
                  disabled={salvando || linhesPreenchidas.length === 0 || salvo}
                >
                  {salvando ? '⏳ Salvando...' : salvo ? '✅ Salvo' : '💾 Salvar Inventário'}
                </button>
              </div>
            </div>

            {saldosPorLote.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">📦</div>
                <div className="empty-text">Nenhum lote com saldo disponível</div>
              </div>
            ) : (
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                  <thead>
                    <tr style={{ background:'rgba(255,255,255,0.04)' }}>
                      <th style={{ padding:'9px 12px', textAlign:'left', color:'var(--text-dim)', fontWeight:600 }}>Lote POY</th>
                      <th style={{ padding:'9px 12px', textAlign:'left', color:'var(--text-dim)', fontWeight:600 }} className="col-hide-mobile">NFs</th>
                      <th style={{ padding:'9px 12px', textAlign:'right', color:'var(--text-dim)', fontWeight:600 }}>Saldo Teórico (kg)</th>
                      <th style={{ padding:'9px 12px', textAlign:'right', color:'var(--text-dim)', fontWeight:600 }}>Contagem Física (kg)</th>
                      <th style={{ padding:'9px 12px', textAlign:'right', color:'var(--text-dim)', fontWeight:600 }}>Divergência (kg)</th>
                      <th style={{ padding:'9px 12px', textAlign:'center', color:'var(--text-dim)', fontWeight:600 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map(l => {
                      const preenchido = contagens[l.lote] !== undefined && contagens[l.lote] !== ''
                      const st = preenchido ? statusDiverg(l.divergencia_pct) : null
                      return (
                        <tr key={l.lote} style={{
                          borderBottom:'1px solid rgba(255,255,255,0.05)',
                          background: st ? st.bg : undefined,
                        }}>
                          <td style={{ padding:'8px 12px', fontWeight:700, fontFamily:'monospace', fontSize:15 }}>
                            {l.lote}
                          </td>
                          <td style={{ padding:'8px 12px', fontSize:12, color:'var(--text-dim)' }} className="col-hide-mobile">
                            {new Set(l.nfs.map(n => n.numero_nf)).size} NF{new Set(l.nfs.map(n => n.numero_nf)).size !== 1 ? 's' : ''}
                          </td>
                          <td style={{ padding:'8px 12px', textAlign:'right', fontFamily:'monospace', fontWeight:600, color:'var(--accent-2)' }}>
                            {fmt(l.saldo_teorico)}
                          </td>
                          <td style={{ padding:'6px 12px', textAlign:'right' }}>
                            <input
                              type="number"
                              step="0.001"
                              min="0"
                              placeholder="0,000"
                              value={contagens[l.lote] ?? ''}
                              onChange={e => {
                                setSalvo(false)
                                setContagens(c => ({ ...c, [l.lote]: e.target.value }))
                              }}
                              style={{
                                width: 120, textAlign:'right', fontFamily:'monospace',
                                background:'rgba(255,255,255,0.06)', border:`1px solid ${st ? st.color : 'var(--border)'}`,
                                borderRadius:6, padding:'5px 8px', color:'var(--text)', fontSize:13,
                                outline:'none',
                              }}
                            />
                          </td>
                          <td style={{ padding:'8px 12px', textAlign:'right', fontFamily:'monospace', fontWeight:600,
                            color: !preenchido ? 'var(--text-dim)' : l.divergencia_kg < -0.01 ? 'var(--danger)' : l.divergencia_kg > 0.01 ? 'var(--warn)' : 'var(--accent-2)'
                          }}>
                            {preenchido
                              ? (l.divergencia_kg >= 0 ? '+' : '') + fmt(l.divergencia_kg) + ` (${l.divergencia_pct >= 0 ? '+' : ''}${l.divergencia_pct.toFixed(2)}%)`
                              : '—'
                            }
                          </td>
                          <td style={{ padding:'8px 12px', textAlign:'center' }}>
                            {st
                              ? <span style={{ fontSize:12, fontWeight:600, color: st.color }}>{st.label}</span>
                              : <span style={{ fontSize:12, color:'var(--text-dim)' }}>—</span>
                            }
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {linhesPreenchidas.length > 0 && (
                    <tfoot>
                      <tr style={{ background:'rgba(255,255,255,0.04)', borderTop:'2px solid var(--border)' }}>
                        <td colSpan={2} style={{ padding:'9px 12px', fontWeight:700, fontSize:12 }}>
                          TOTAL ({linhesPreenchidas.length} lotes contados)
                        </td>
                        <td style={{ padding:'9px 12px', textAlign:'right', fontFamily:'monospace', fontWeight:700, color:'var(--accent-2)' }}>
                          {fmt(totalTeorico)}
                        </td>
                        <td style={{ padding:'9px 12px', textAlign:'right', fontFamily:'monospace', fontWeight:700, color:'var(--accent)' }}>
                          {fmt(totalFisico)}
                        </td>
                        <td style={{ padding:'9px 12px', textAlign:'right', fontFamily:'monospace', fontWeight:700,
                          color: Math.abs(totalDiverg) < 0.01 ? 'var(--accent-2)' : totalDiverg < 0 ? 'var(--danger)' : 'var(--warn)'
                        }}>
                          {totalDiverg >= 0 ? '+' : ''}{fmt(totalDiverg)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── ABA HISTÓRICO ── */}
      {abaAtiva === 'historico' && (
        <div className="card">
          <div className="card-title" style={{ marginBottom:16 }}>Inventários Anteriores</div>
          {historico.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">🕓</div>
              <div className="empty-text">Nenhum inventário salvo ainda</div>
            </div>
          ) : (
            historico.map(inv => (
              <InventarioHistoricoCard key={inv.id} inv={inv} unidadeId={unidadeAtiva || ''} />
            ))
          )}
        </div>
      )}

      <Toast toasts={toasts} />
    </div>
  )
}

function InventarioHistoricoCard({ inv, unidadeId }) {
  const [open, setOpen] = useState(false)
  const linhas = inv.linhas || []
  const totalTeorico = linhas.reduce((a, l) => a + Number(l.saldo_teorico || 0), 0)
  const totalFisico  = linhas.reduce((a, l) => a + Number(l.contagem_kg || 0), 0)
  const totalDiverg  = totalFisico - totalTeorico
  const criticas = linhas.filter(l => Math.abs(Number(l.divergencia_pct || 0)) >= 2).length

  return (
    <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid var(--border)', borderRadius:12, marginBottom:12, overflow:'hidden' }}>
      <div style={{ padding:'14px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:14 }}>
            {inv.criado_em ? new Date(inv.criado_em).toLocaleString('pt-BR') : '—'}
          </div>
          <div style={{ fontSize:12, color:'var(--text-dim)', marginTop:2 }}>
            {linhas.length} lotes · por {inv.criado_por || '—'}
          </div>
        </div>
        <div style={{ display:'flex', gap:16, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ textAlign:'right', fontSize:12 }}>
            <div style={{ color:'var(--text-dim)' }}>Divergência</div>
            <div style={{ fontWeight:700, fontFamily:'monospace', color: Math.abs(totalDiverg) < 0.01 ? 'var(--accent-2)' : 'var(--warn)' }}>
              {totalDiverg >= 0 ? '+' : ''}{fmt(totalDiverg)} kg
            </div>
          </div>
          {criticas > 0 && (
            <span style={{ background:'rgba(255,60,60,0.15)', color:'var(--danger)', borderRadius:99, padding:'3px 10px', fontSize:12, fontWeight:700 }}>
              🚨 {criticas} crítico{criticas !== 1 ? 's' : ''}
            </span>
          )}
          <div style={{ display:'flex', gap:6 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => gerarInventarioPDF(linhas, unidadeId, inv.criado_em ? new Date(inv.criado_em).toLocaleDateString('pt-BR') : '')}>
              📄 PDF
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)}>
              {open ? '▲' : '▼'}
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div style={{ borderTop:'1px solid var(--border)', padding:'12px 16px', background:'rgba(0,0,0,0.1)' }}>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'rgba(255,255,255,0.04)' }}>
                  <th style={{ padding:'6px 10px', textAlign:'left', color:'var(--text-dim)' }}>Lote</th>
                  <th style={{ padding:'6px 10px', textAlign:'right', color:'var(--text-dim)' }}>Teórico kg</th>
                  <th style={{ padding:'6px 10px', textAlign:'right', color:'var(--text-dim)' }}>Físico kg</th>
                  <th style={{ padding:'6px 10px', textAlign:'right', color:'var(--text-dim)' }}>Diverg. kg</th>
                  <th style={{ padding:'6px 10px', textAlign:'center', color:'var(--text-dim)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => {
                  const st = statusDiverg(Number(l.divergencia_pct || 0))
                  return (
                    <tr key={i} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding:'6px 10px', fontWeight:700, fontFamily:'monospace' }}>{l.lote}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right', fontFamily:'monospace' }}>{fmt(l.saldo_teorico)}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right', fontFamily:'monospace' }}>{fmt(l.contagem_kg)}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right', fontFamily:'monospace', fontWeight:600,
                        color: l.divergencia_kg < -0.01 ? 'var(--danger)' : l.divergencia_kg > 0.01 ? 'var(--warn)' : 'var(--accent-2)' }}>
                        {(l.divergencia_kg >= 0 ? '+' : '') + fmt(l.divergencia_kg)}
                      </td>
                      <td style={{ padding:'6px 10px', textAlign:'center', fontSize:11, fontWeight:600, color: st.color }}>{st.label}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
