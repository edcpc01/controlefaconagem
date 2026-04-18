import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listarNFsEntrada, listarSaidas, TIPOS_SAIDA, statusVencimentoNF, diasParaVencimento } from '../lib/faconagem'
import { useUser } from '../lib/UserContext'
import { useOperacao } from '../lib/OperacaoContext'
import { format } from 'date-fns'

const fmt  = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt4 = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function tipoBadge(tipo) {
  const map = { faturamento:'badge-blue', sucata:'badge-danger', estopa:'badge-warn', dev_qualidade:'badge-green', dev_processo:'badge-green', dev_final_campanha:'badge-green' }
  const label = TIPOS_SAIDA.find(t => t.value === tipo)?.label || tipo
  return <span className={`badge ${map[tipo] || 'badge-blue'}`}>{label}</span>
}

function agruparPorLote(nfs) {
  const mapa = {}
  for (const nf of nfs) {
    const key = nf.lote || '(sem lote)'
    if (!mapa[key]) mapa[key] = { lote: key, nfs: [], totalKg: 0, saldoKg: 0 }
    mapa[key].nfs.push(nf)
    mapa[key].totalKg += Number(nf.volume_kg)
    mapa[key].saldoKg += Number(nf.volume_saldo_kg)
  }
  return Object.values(mapa).sort((a, b) => b.totalKg - a.totalKg)
}

function agruparSaidasPorLote(saidas) {
  const mapa = {}
  for (const s of saidas) {
    const key = s.lote_poy || s.lote_produto || '(sem lote)'
    if (!mapa[key]) mapa[key] = { lote: key, saidas: [], totalLiq: 0, totalFinal: 0 }
    mapa[key].saidas.push(s)
    mapa[key].totalLiq   += Number(s.volume_liquido_kg || s.volume_bruto_kg || 0)
    mapa[key].totalFinal += Number(s.volume_abatido_kg || 0)
  }
  return Object.values(mapa).sort((a, b) => b.totalFinal - a.totalFinal)
}

function LoteCardEntrada({ grupo, navigate }) {
  const [open, setOpen] = useState(false)
  const pct = grupo.totalKg > 0 ? (grupo.saldoKg / grupo.totalKg) * 100 : 0
  return (
    <div className="lote-card">
      <div className="lote-card-header" onClick={() => setOpen(o => !o)}>
        <div>
          <div className="lote-card-title">Lote <span style={{color:'var(--accent)'}}>{grupo.lote}</span></div>
          <div className="lote-card-sub">{grupo.nfs.length} NF{grupo.nfs.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{textAlign:'right'}}>
          <div className="lote-card-kg" style={{color: pct < 10 ? 'var(--danger)' : 'var(--accent-2)'}}>
            {fmt4(grupo.saldoKg)} kg
          </div>
          <div style={{fontSize:11, color:'var(--text-dim)'}}>saldo de {fmt(grupo.totalKg)} kg</div>
        </div>
      </div>
      <div className="progress-bar-bg" style={{margin:'10px 0 4px'}}>
        <div className="progress-bar-fill" style={{
          width:`${Math.min(100-pct,100)}%`,
          background: pct < 10 ? 'var(--danger)' : pct < 30 ? 'var(--warn)' : 'linear-gradient(90deg,var(--accent),var(--accent-2))'
        }}/>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--text-dim)',marginBottom: open ? 10 : 0}}>
        <span>{(100-pct).toFixed(1)}% consumido</span>
        <span>{pct.toFixed(1)}% disponível</span>
      </div>
      {open && (
        <div className="lote-nf-list">
          {grupo.nfs.map(nf => (
            <div key={nf.id} className="lote-nf-row">
              <div>
                <span className="td-mono" style={{fontWeight:600,fontSize:13}}>NF {nf.numero_nf}</span>
                <span style={{fontSize:11,color:'var(--text-dim)',marginLeft:8}}>
                  {nf.data_emissao ? format(new Date(nf.data_emissao),'dd/MM/yyyy') : ''}
                </span>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span className="td-mono" style={{fontSize:13,color:Number(nf.volume_saldo_kg)<=0.01?'var(--danger)':'var(--accent-2)',fontWeight:600}}>
                  {fmt4(nf.volume_saldo_kg)} kg
                </span>
                <button className="btn btn-ghost btn-sm" onClick={()=>navigate(`/nf/${nf.id}`)}>🔍</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <button className="lote-expand-btn" onClick={()=>setOpen(o=>!o)}>
        {open ? '▲ Recolher' : `▼ Ver ${grupo.nfs.length} NF${grupo.nfs.length!==1?'s':''}`}
      </button>
    </div>
  )
}

function LoteCardSaida({ grupo }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="lote-card">
      <div className="lote-card-header" onClick={()=>setOpen(o=>!o)}>
        <div>
          <div className="lote-card-title">Lote <span style={{color:'var(--accent)'}}>{grupo.lote}</span></div>
          <div className="lote-card-sub">{grupo.saidas.length} saída{grupo.saidas.length!==1?'s':''}</div>
        </div>
        <div style={{textAlign:'right'}}>
          <div className="lote-card-kg" style={{color:'var(--accent)'}}>{fmt4(grupo.totalFinal)} kg</div>
          <div style={{fontSize:11,color:'var(--text-dim)'}}>total debitado</div>
        </div>
      </div>
      <div style={{display:'flex',gap:16,margin:'8px 0 4px',flexWrap:'wrap',fontSize:12}}>
        <span><span style={{color:'var(--text-dim)'}}>Líq.: </span><span className="td-mono">{fmt4(grupo.totalLiq)} kg</span></span>
        <span><span style={{color:'var(--text-dim)'}}>Romaneios: </span><span className="td-mono">{grupo.saidas.length}</span></span>
      </div>
      {open && (
        <div className="lote-nf-list">
          {grupo.saidas.map(s => (
            <div key={s.id} className="lote-nf-row">
              <div>
                <span className="td-mono" style={{fontWeight:600,fontSize:13}}>{s.romaneio_microdata}</span>
                <span style={{marginLeft:8}}>{tipoBadge(s.tipo_saida)}</span>
              </div>
              <span className="td-mono" style={{fontSize:13,color:'var(--accent)',fontWeight:600}}>
                {fmt4(s.volume_abatido_kg)} kg
              </span>
            </div>
          ))}
        </div>
      )}
      <button className="lote-expand-btn" onClick={()=>setOpen(o=>!o)}>
        {open ? '▲ Recolher' : `▼ Ver ${grupo.saidas.length} romaneio${grupo.saidas.length!==1?'s':''}`}
      </button>
    </div>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { unidadeAtiva } = useUser() || {}
  const ctx = useUser()
  const { colecoes, operacaoAtiva } = useOperacao() || {}
  const isAdmin = ctx?.isAdmin ?? false
  const [nfs,     setNfs]     = useState([])
  const [saidas,  setSaidas]  = useState([])
  const [loading, setLoading] = useState(true)

  // Anomalia IA
  const [anomaliaLoading, setAnomaliaLoading] = useState(false)
  const [anomaliaResultado, setAnomaliaResultado] = useState(null) // null | {alertas:[], resumo:''}
  const [anomaliaErro, setAnomaliaErro] = useState('')

  useEffect(() => {
    setLoading(true)
    Promise.all([listarNFsEntrada(unidadeAtiva || '', colecoes), listarSaidas(unidadeAtiva || '', colecoes)])
      .then(([n,s]) => { setNfs(n); setSaidas(s) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [unidadeAtiva, operacaoAtiva])

  const totalEntrada = nfs.reduce((a,n) => a + Number(n.volume_kg), 0)
  const totalSaldo   = nfs.reduce((a,n) => a + Number(n.volume_saldo_kg), 0)
  const totalSaida   = saidas.reduce((a,s) => a + Number(s.volume_abatido_kg), 0)
  const nfsZeradas   = nfs.filter(n => Number(n.volume_saldo_kg) <= 0.01).length
  const nfsVencidas  = nfs.filter(n => statusVencimentoNF(n) === 'vencida')
  const nfsAlerta    = nfs.filter(n => statusVencimentoNF(n) === 'alerta')
  const lotesEntrada = agruparPorLote(nfs)
  const lotesSaida   = agruparSaidasPorLote(saidas)

  // Detecção de anomalia via IA
  const analisarAnomalias = async () => {
    if (saidas.length < 5) { setAnomaliaErro('Dados insuficientes (mínimo 5 saídas).'); return }
    setAnomaliaLoading(true)
    setAnomaliaResultado(null)
    setAnomaliaErro('')
    try {
      // Calcula baseline: média e desvio dos últimos 60 dias por tipo
      const agora = Date.now()
      const saidas60 = saidas.filter(s => s.criado_em && (agora - new Date(s.criado_em)) < 60*24*60*60*1000)
      const saidas7  = saidas.filter(s => s.criado_em && (agora - new Date(s.criado_em)) < 7*24*60*60*1000)

      const estatsPorTipo = {}
      for (const s of saidas60) {
        const t = s.tipo_saida
        if (!estatsPorTipo[t]) estatsPorTipo[t] = []
        estatsPorTipo[t].push(Number(s.volume_abatido_kg || 0))
      }
      const baseline = Object.entries(estatsPorTipo).map(([tipo, vals]) => {
        const media = vals.reduce((a,v)=>a+v,0) / vals.length
        const std   = Math.sqrt(vals.reduce((a,v)=>a+(v-media)**2,0)/vals.length)
        return { tipo, media: media.toFixed(2), desvio: std.toFixed(2), n: vals.length }
      })

      const resumoRecente = saidas7.map(s => ({
        romaneio: s.romaneio_microdata,
        tipo: s.tipo_saida,
        lote: s.lote_poy || s.lote_produto || '—',
        volume_kg: Number(s.volume_abatido_kg||0).toFixed(2),
        data: s.criado_em ? new Date(s.criado_em).toLocaleString('pt-BR') : '—',
      }))

      const prompt = `Você é um sistema de detecção de anomalias para controle de façonagem (terceirização têxtil).

BASELINE (últimos 60 dias) por tipo de saída:
${JSON.stringify(baseline, null, 2)}

SAÍDAS DOS ÚLTIMOS 7 DIAS:
${JSON.stringify(resumoRecente, null, 2)}

Analise se há anomalias nas saídas recentes comparando com o baseline.
Considere anomalia: volume > média + 2× desvio, padrão incomum de tipo, lote não visto antes, horário atípico.

Responda SOMENTE em JSON, sem texto extra, sem markdown:
{
  "alertas": [
    { "nivel": "critico|atencao|info", "romaneio": "...", "motivo": "descrição curta em português" }
  ],
  "resumo": "frase curta de 1-2 linhas em português sobre o estado geral"
}`

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }]
        })
      })
      const data = await res.json()
      const texto = data.content?.find(b => b.type === 'text')?.text || ''
      const clean = texto.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean)
      setAnomaliaResultado(parsed)
    } catch (e) {
      setAnomaliaErro('Erro ao analisar anomalias: ' + e.message)
    } finally {
      setAnomaliaLoading(false)
    }
  }

  if (loading) return <div className="loading"><div className="spinner"/><div>Carregando...</div></div>

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Dashboard <span>Façonagem</span></div>
        <div className="page-sub">Visão geral do controle de entradas e saídas</div>
      </div>

      {/* KPIs */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Entrada</div>
          <div className="stat-value">{fmt(totalEntrada)}</div>
          <div className="stat-unit">kg em {nfs.length} NFs</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Saldo Disponível</div>
          <div className="stat-value" style={{color:'var(--accent)'}}>{fmt(totalSaldo)}</div>
          <div className="stat-unit">kg em estoque</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Saídas</div>
          <div className="stat-value">{fmt(totalSaida)}</div>
          <div className="stat-unit">kg em {saidas.length} romaneios</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">NFs Zeradas</div>
          <div className="stat-value" style={{color: nfsZeradas > 0 ? 'var(--warn)' : 'var(--text)'}}>{nfsZeradas}</div>
          <div className="stat-unit">de {nfs.length} NFs</div>
        </div>
      </div>

      {/* ── Alertas vencimento ── */}
      {(nfsVencidas.length > 0 || nfsAlerta.length > 0) && (
        <div className="card" style={{ marginBottom: 20, border: `1px solid ${nfsVencidas.length > 0 ? 'var(--danger)' : 'var(--warn)'}`, background: nfsVencidas.length > 0 ? 'rgba(255,60,60,0.06)' : 'rgba(255,180,0,0.06)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
            <span style={{ fontSize:22 }}>{nfsVencidas.length > 0 ? '🚨' : '⚠️'}</span>
            <div>
              <div style={{ fontWeight:700, fontSize:15, color: nfsVencidas.length > 0 ? 'var(--danger)' : 'var(--warn)' }}>
                {nfsVencidas.length > 0
                  ? `${nfsVencidas.length} NF${nfsVencidas.length > 1 ? 's' : ''} com prazo vencido`
                  : `${nfsAlerta.length} NF${nfsAlerta.length > 1 ? 's' : ''} próximas do vencimento`}
              </div>
              <div style={{ fontSize:12, color:'var(--text-dim)' }}>NFs com saldo em aberto há mais de 6 meses devem ser verificadas</div>
            </div>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft:'auto' }} onClick={() => navigate('/entrada')}>Ver NFs →</button>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {[...nfsVencidas, ...nfsAlerta].sort((a,b) => diasParaVencimento(a) - diasParaVencimento(b)).map(nf => {
              const dias = diasParaVencimento(nf)
              const vencida = dias < 0
              return (
                <div key={nf.id} style={{
                  display:'flex', justifyContent:'space-between', alignItems:'center',
                  background:'rgba(255,255,255,0.04)', borderRadius:10, padding:'10px 14px',
                  border: `1px solid ${vencida ? 'rgba(255,60,60,0.3)' : 'rgba(255,180,0,0.3)'}`,
                }}>
                  <div>
                    <span style={{ fontWeight:700, fontSize:14 }}>NF {nf.numero_nf}</span>
                    <span style={{ fontSize:12, color:'var(--text-dim)', marginLeft:10 }}>
                      Lote {nf.lote || '—'} · {nf.data_emissao ? new Date(nf.data_emissao).toLocaleDateString('pt-BR') : '—'}
                    </span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ fontSize:12, fontWeight:600, color: vencida ? 'var(--danger)' : 'var(--warn)' }}>
                      {vencida ? `Vencida há ${Math.abs(dias)} dia${Math.abs(dias)!==1?'s':''}` : `Vence em ${dias} dia${dias!==1?'s':''}`}
                    </span>
                    <span style={{ fontSize:13, color:'var(--accent-2)', fontWeight:600 }}>
                      {Number(nf.volume_saldo_kg).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} kg
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/nf/${nf.id}`)}>🔍</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {/* ── Detecção de anomalia (só admin) ── */}
      {isAdmin && (
        <div className="card" style={{ marginBottom:20, borderColor: anomaliaResultado?.alertas?.some(a=>a.nivel==='critico') ? 'var(--danger)' : 'var(--border)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
            <div>
              <div className="card-title" style={{ margin:0 }}>🤖 Detecção de Anomalias — IA</div>
              <div style={{ fontSize:12, color:'var(--text-dim)', marginTop:2 }}>
                Compara saídas recentes com o baseline histórico e identifica desvios
              </div>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={analisarAnomalias}
              disabled={anomaliaLoading}
            >
              {anomaliaLoading ? '⏳ Analisando...' : '⚡ Analisar Agora'}
            </button>
          </div>

          {anomaliaErro && (
            <div style={{ marginTop:12, padding:'8px 12px', background:'rgba(255,60,60,0.1)', borderRadius:8, color:'var(--danger)', fontSize:13 }}>
              {anomaliaErro}
            </div>
          )}

          {anomaliaResultado && (
            <div style={{ marginTop:14 }}>
              {/* Resumo geral */}
              <div style={{ padding:'10px 14px', background:'rgba(255,255,255,0.04)', borderRadius:8, marginBottom:12, fontSize:13, color:'var(--text)', borderLeft:'3px solid var(--accent)' }}>
                💬 {anomaliaResultado.resumo}
              </div>

              {anomaliaResultado.alertas.length === 0 ? (
                <div style={{ fontSize:13, color:'var(--accent-2)', fontWeight:600 }}>✅ Nenhuma anomalia detectada nas últimas saídas.</div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {anomaliaResultado.alertas.map((a, i) => {
                    const cor = a.nivel === 'critico' ? 'var(--danger)' : a.nivel === 'atencao' ? 'var(--warn)' : 'var(--accent)'
                    const icon = a.nivel === 'critico' ? '🚨' : a.nivel === 'atencao' ? '⚠️' : 'ℹ️'
                    return (
                      <div key={i} style={{
                        display:'flex', alignItems:'flex-start', gap:10, padding:'10px 14px',
                        background:'rgba(255,255,255,0.03)', borderRadius:8,
                        border:`1px solid ${cor}33`
                      }}>
                        <span style={{ fontSize:16 }}>{icon}</span>
                        <div>
                          <span style={{ fontWeight:700, color: cor, fontSize:13 }}>
                            {a.romaneio}
                          </span>
                          <span style={{ fontSize:13, color:'var(--text)', marginLeft:8 }}>{a.motivo}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="dash-grid">

        {/* A — NFs Recentes */}
        <div className="dash-grid-a card">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
            <div className="card-title" style={{margin:0}}>NFs Recentes — Saldo</div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/entrada')}>Ver todas →</button>
          </div>
          <div className="table-wrap" style={{flex:1}}>
            <table>
              <thead>
                <tr>
                  <th>NF</th>
                  <th>Lote POY</th>
                  <th className="td-right">Saldo (kg)</th>
                  <th className="col-hide-mobile"></th>
                </tr>
              </thead>
              <tbody>
                {nfs.length === 0 && (
                  <tr><td colSpan={4}><div className="empty"><div className="empty-icon">📦</div><div className="empty-text">Nenhuma NF</div></div></td></tr>
                )}
                {nfs.slice(0,6).map(nf => (
                  <tr key={nf.id}>
                    <td className="td-mono" style={{fontWeight:600}}>{nf.numero_nf}</td>
                    <td className="td-mono">{nf.lote}</td>
                    <td className="td-right td-mono" style={{color: Number(nf.volume_saldo_kg) <= 0.01 ? 'var(--danger)' : 'var(--accent-2)', fontWeight:600}}>
                      {fmt4(nf.volume_saldo_kg)}
                    </td>
                    <td className="col-hide-mobile"><button className="btn btn-ghost btn-sm" onClick={() => navigate(`/nf/${nf.id}`)}>🔍</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* B — Últimas Saídas */}
        <div className="dash-grid-b card">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
            <div className="card-title" style={{margin:0}}>Últimas Saídas</div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/saida')}>Ver todas →</button>
          </div>
          <div className="table-wrap" style={{flex:1}}>
            <table>
              <thead>
                <tr>
                  <th>Romaneio</th>
                  <th className="col-hide-mobile">Lote POY</th>
                  <th>Tipo</th>
                  <th className="td-right">Vol. Final</th>
                </tr>
              </thead>
              <tbody>
                {saidas.length === 0 && (
                  <tr><td colSpan={4}><div className="empty"><div className="empty-icon">📋</div><div className="empty-text">Nenhuma saída</div></div></td></tr>
                )}
                {saidas.slice(0,6).map(s => (
                  <tr key={s.id}>
                    <td className="td-mono">{s.romaneio_microdata}</td>
                    <td className="td-mono col-hide-mobile">{s.lote_poy || s.lote_produto || '—'}</td>
                    <td>{tipoBadge(s.tipo_saida)}</td>
                    <td className="td-right td-mono" style={{color:'var(--accent)'}}>{fmt(s.volume_abatido_kg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* C — Entradas por Lote */}
        {lotesEntrada.length > 0 && (
          <div className="dash-grid-c card" style={{padding:'14px 18px'}}>
            <div className="dash-section-divider" style={{marginTop:0}}>Entradas por Lote POY</div>
            <div className="lote-col-stack">
              {lotesEntrada.map(g => <LoteCardEntrada key={g.lote} grupo={g} navigate={navigate} />)}
            </div>
          </div>
        )}

        {/* D — Saídas por Lote */}
        {lotesSaida.length > 0 && (
          <div className="dash-grid-d card" style={{padding:'14px 18px'}}>
            <div className="dash-section-divider" style={{marginTop:0}}>Saídas por Lote POY</div>
            <div className="lote-col-stack">
              {lotesSaida.map(g => <LoteCardSaida key={g.lote} grupo={g} />)}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
