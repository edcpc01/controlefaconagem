import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listarNFsEntrada, listarSaidas, TIPOS_SAIDA } from '../lib/faconagem'
import { format } from 'date-fns'

const fmt  = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt4 = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

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

// ── Card expansível por lote ──
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
          width: `${Math.min(100 - pct, 100)}%`,
          background: pct < 10 ? 'var(--danger)' : pct < 30 ? 'var(--warn)' : 'linear-gradient(90deg, var(--accent), var(--accent-2))'
        }} />
      </div>
      <div style={{display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text-dim)', marginBottom: open ? 10 : 0}}>
        <span>{(100 - pct).toFixed(1)}% consumido</span>
        <span>{pct.toFixed(1)}% disponível</span>
      </div>
      {open && (
        <div className="lote-nf-list">
          {grupo.nfs.map(nf => (
            <div key={nf.id} className="lote-nf-row">
              <div>
                <span className="td-mono" style={{fontWeight:600, fontSize:13}}>NF {nf.numero_nf}</span>
                <span style={{fontSize:11, color:'var(--text-dim)', marginLeft:8}}>
                  {nf.data_emissao ? format(new Date(nf.data_emissao), 'dd/MM/yyyy') : ''}
                </span>
              </div>
              <div style={{display:'flex', alignItems:'center', gap:10}}>
                <span className="td-mono" style={{fontSize:13, color: Number(nf.volume_saldo_kg) <= 0.01 ? 'var(--danger)' : 'var(--accent-2)', fontWeight:600}}>
                  {fmt4(nf.volume_saldo_kg)} kg
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/nf/${nf.id}`)}>
                  🔍
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <button className="lote-expand-btn" onClick={() => setOpen(o => !o)}>
        {open ? '▲ Recolher' : `▼ Ver ${grupo.nfs.length} NF${grupo.nfs.length !== 1 ? 's' : ''}`}
      </button>
    </div>
  )
}

function LoteCardSaida({ grupo }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="lote-card">
      <div className="lote-card-header" onClick={() => setOpen(o => !o)}>
        <div>
          <div className="lote-card-title">Lote <span style={{color:'var(--accent)'}}>{grupo.lote}</span></div>
          <div className="lote-card-sub">{grupo.saidas.length} saída{grupo.saidas.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{textAlign:'right'}}>
          <div className="lote-card-kg" style={{color:'var(--accent)'}}>{fmt4(grupo.totalFinal)} kg</div>
          <div style={{fontSize:11, color:'var(--text-dim)'}}>total debitado</div>
        </div>
      </div>
      <div style={{display:'flex', gap:16, margin:'8px 0 4px', flexWrap:'wrap', fontSize:12}}>
        <span><span style={{color:'var(--text-dim)'}}>Líq.: </span><span className="td-mono">{fmt4(grupo.totalLiq)} kg</span></span>
        <span><span style={{color:'var(--text-dim)'}}>Romaneios: </span><span className="td-mono">{grupo.saidas.length}</span></span>
      </div>
      {open && (
        <div className="lote-nf-list">
          {grupo.saidas.map(s => (
            <div key={s.id} className="lote-nf-row">
              <div>
                <span className="td-mono" style={{fontWeight:600, fontSize:13}}>{s.romaneio_microdata}</span>
                <span style={{marginLeft:8}}>{tipoBadge(s.tipo_saida)}</span>
              </div>
              <span className="td-mono" style={{fontSize:13, color:'var(--accent)', fontWeight:600}}>
                {fmt4(s.volume_abatido_kg)} kg
              </span>
            </div>
          ))}
        </div>
      )}
      <button className="lote-expand-btn" onClick={() => setOpen(o => !o)}>
        {open ? '▲ Recolher' : `▼ Ver ${grupo.saidas.length} romaneio${grupo.saidas.length !== 1 ? 's' : ''}`}
      </button>
    </div>
  )
}

// ── Página principal ───────────────────────────────────────────────────────
export default function DashboardPage() {
  const navigate = useNavigate()
  const [nfs, setNfs]         = useState([])
  const [saidas, setSaidas]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([listarNFsEntrada(), listarSaidas()])
      .then(([n, s]) => { setNfs(n); setSaidas(s) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const totalEntrada = nfs.reduce((a, n) => a + Number(n.volume_kg), 0)
  const totalSaldo   = nfs.reduce((a, n) => a + Number(n.volume_saldo_kg), 0)
  const totalSaida   = saidas.reduce((a, s) => a + Number(s.volume_abatido_kg), 0)
  const nfsZeradas   = nfs.filter(n => Number(n.volume_saldo_kg) <= 0.01).length

  const lotesEntrada = agruparPorLote(nfs)
  const lotesSaida   = agruparSaidasPorLote(saidas)

  if (loading) return <div className="loading"><div className="spinner"></div><div>Carregando...</div></div>

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Dashboard <span>Façonagem</span></div>
        <div className="page-sub">Visão geral do controle de entradas e saídas</div>
      </div>

      {/* ── KPIs ── */}
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

      {/* ── Layout 2 colunas: esquerda = entradas, direita = saídas ── */}
      <div className="dashboard-cols">

        {/* ── COLUNA ESQUERDA: Tabela NFs + Cards por Lote de Entrada ── */}
        <div className="dashboard-col">
          {/* Tabela NFs Recentes + Cards Entradas por Lote — mesmo card */}
          <div className="card">
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16}}>
              <div className="card-title" style={{margin:0}}>NFs Recentes — Saldo</div>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/entrada')}>Ver todas →</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>NF</th><th>Lote POY</th><th className="td-right">Saldo (kg)</th><th></th></tr>
                </thead>
                <tbody>
                  {nfs.length === 0 && (
                    <tr><td colSpan={4}><div className="empty"><div className="empty-icon">📦</div><div className="empty-text">Nenhuma NF</div></div></td></tr>
                  )}
                  {nfs.slice(0, 6).map(nf => (
                    <tr key={nf.id}>
                      <td className="td-mono" style={{fontWeight:600}}>{nf.numero_nf}</td>
                      <td className="td-mono">{nf.lote}</td>
                      <td className="td-right td-mono" style={{color: Number(nf.volume_saldo_kg) <= 0.01 ? 'var(--danger)' : 'var(--accent-2)', fontWeight:600}}>
                        {fmt4(nf.volume_saldo_kg)}
                      </td>
                      <td><button className="btn btn-ghost btn-sm" onClick={() => navigate(`/nf/${nf.id}`)}>🔍</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {lotesEntrada.length > 0 && (
              <>
                <div className="dash-section-divider">Entradas por Lote POY</div>
                <div className="lote-col-stack">
                  {lotesEntrada.map(g => <LoteCardEntrada key={g.lote} grupo={g} navigate={navigate} />)}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── COLUNA DIREITA: Tabela Saídas + Cards por Lote de Saída ── */}
        <div className="dashboard-col">
          {/* Tabela Últimas Saídas + Cards Saídas por Lote — mesmo card */}
          <div className="card">
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16}}>
              <div className="card-title" style={{margin:0}}>Últimas Saídas</div>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/saida')}>Ver todas →</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Romaneio</th><th>Lote POY</th><th>Tipo</th><th className="td-right">Vol. Final</th></tr>
                </thead>
                <tbody>
                  {saidas.length === 0 && (
                    <tr><td colSpan={4}><div className="empty"><div className="empty-icon">📋</div><div className="empty-text">Nenhuma saída</div></div></td></tr>
                  )}
                  {saidas.slice(0, 6).map(s => (
                    <tr key={s.id}>
                      <td className="td-mono">{s.romaneio_microdata}</td>
                      <td className="td-mono">{s.lote_poy || s.lote_produto || '—'}</td>
                      <td>{tipoBadge(s.tipo_saida)}</td>
                      <td className="td-right td-mono" style={{color:'var(--accent)'}}>{fmt(s.volume_abatido_kg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {lotesSaida.length > 0 && (
              <>
                <div className="dash-section-divider">Saídas por Lote POY</div>
                <div className="lote-col-stack">
                  {lotesSaida.map(g => <LoteCardSaida key={g.lote} grupo={g} />)}
                </div>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
