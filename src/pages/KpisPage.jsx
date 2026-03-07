import { useEffect, useState } from 'react'
import { listarNFsEntrada, listarSaidas, TIPOS_SAIDA } from '../lib/faconagem'
import { useUser } from '../lib/UserContext'

const fmt  = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct  = (v, total) => total > 0 ? ((v / total) * 100).toFixed(1) : '0.0'
const pctN = (v, total) => total > 0 ? (v / total) * 100 : 0

// Agrupa saídas por lote e calcula KPIs por tipo
function calcKpiPorLote(nfs, saidas) {
  const lotes = {}

  // Inicializa com todos os lotes das NFs
  for (const nf of nfs) {
    const key = nf.lote || '(sem lote)'
    if (!lotes[key]) lotes[key] = { lote: key, entradaKg: 0, fat: 0, dev: 0, suc: 0, outros: 0 }
    lotes[key].entradaKg += Number(nf.volume_kg || 0)
  }

  // Soma saídas por tipo no lote
  for (const s of saidas) {
    const key = s.lote_poy || s.lote_produto || '(sem lote)'
    if (!lotes[key]) lotes[key] = { lote: key, entradaKg: 0, fat: 0, dev: 0, suc: 0, outros: 0 }
    const v = Number(s.volume_abatido_kg || 0)
    if (s.tipo_saida === 'faturamento')            lotes[key].fat   += v
    else if (s.tipo_saida?.startsWith('dev_'))     lotes[key].dev   += v
    else if (['sucata','estopa'].includes(s.tipo_saida)) lotes[key].suc += v
    else                                           lotes[key].outros += v
  }

  return Object.values(lotes).sort((a, b) => b.entradaKg - a.entradaKg)
}

// Barra de progresso segmentada
function BarraSegmentada({ fat, dev, suc, outros, total }) {
  const pFat = pctN(fat, total)
  const pDev = pctN(dev, total)
  const pSuc = pctN(suc, total)
  const pOut = pctN(outros, total)
  return (
    <div style={{
      display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden',
      background: 'rgba(255,255,255,0.07)', margin: '10px 0'
    }}>
      {pFat > 0 && <div style={{ width: `${pFat}%`, background: 'var(--accent)', transition: 'width .4s' }} title={`Faturamento ${pFat.toFixed(1)}%`} />}
      {pDev > 0 && <div style={{ width: `${pDev}%`, background: 'var(--accent-2)', transition: 'width .4s' }} title={`Devolução ${pDev.toFixed(1)}%`} />}
      {pSuc > 0 && <div style={{ width: `${pSuc}%`, background: 'var(--danger)', transition: 'width .4s' }} title={`Sucata ${pSuc.toFixed(1)}%`} />}
      {pOut > 0 && <div style={{ width: `${pOut}%`, background: 'var(--warn)', transition: 'width .4s' }} title={`Outros ${pOut.toFixed(1)}%`} />}
    </div>
  )
}

// Legenda compacta
function Legenda() {
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, marginBottom: 18, color: 'var(--text-dim)' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--accent)', display: 'inline-block' }} /> Faturamento
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--accent-2)', display: 'inline-block' }} /> Devolução
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--danger)', display: 'inline-block' }} /> Sucata/Estopa
      </span>
    </div>
  )
}

// Card de KPI individual (número + label)
function KpiNum({ label, valor, pctVal, color }) {
  return (
    <div className="kpi-num-card">
      <div className="kpi-num-label">{label}</div>
      <div className="kpi-num-value" style={{ color: color || 'var(--text)' }}>{fmt(valor)}</div>
      <div className="kpi-num-unit">kg</div>
      <div className="kpi-num-pct" style={{ color: color || 'var(--text-dim)' }}>{pctVal}%</div>
    </div>
  )
}

// Card por lote
function LoteKpiCard({ g }) {
  const [open, setOpen] = useState(false)
  const base = g.entradaKg || (g.fat + g.dev + g.suc + g.outros)
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '14px 16px', marginBottom: 12
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            Lote <span style={{ color: 'var(--accent)' }}>{g.lote}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
            Entrada: {fmt(g.entradaKg)} kg
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Fat. {pct(g.fat, base)}%</div>
          <div style={{ fontSize: 11, color: 'var(--danger)' }}>Suc. {pct(g.suc, base)}%</div>
        </div>
      </div>

      {/* Barra */}
      <BarraSegmentada fat={g.fat} dev={g.dev} suc={g.suc} outros={g.outros} total={base} />

      {/* Detalhe expandido */}
      {open && (
        <div className="kpi-grid-2" style={{ marginTop: 8 }}>
          <KpiNum label="Faturamento"   valor={g.fat} pctVal={pct(g.fat, base)} color="var(--accent)"   />
          <KpiNum label="Devolução"     valor={g.dev} pctVal={pct(g.dev, base)} color="var(--accent-2)" />
          <KpiNum label="Sucata/Estopa" valor={g.suc} pctVal={pct(g.suc, base)} color="var(--danger)"   />
        </div>
      )}

      <button onClick={() => setOpen(o => !o)} style={{
        background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 11,
        cursor: 'pointer', marginTop: 6, padding: 0
      }}>
        {open ? '▲ Recolher' : '▼ Ver detalhes'}
      </button>
    </div>
  )
}

export default function KpisPage() {
  const { unidadeAtiva } = useUser() || {}
  const [nfs,     setNfs]     = useState([])
  const [saidas,  setSaidas]  = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([listarNFsEntrada(unidadeAtiva || ''), listarSaidas(unidadeAtiva || '')])
      .then(([n, s]) => { setNfs(n); setSaidas(s) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [unidadeAtiva])

  // ── Totais gerais ─────────────────────────────────────────────
  const totalEntrada = nfs.reduce((a, n) => a + Number(n.volume_kg || 0), 0)
  const totalSaldo   = nfs.reduce((a, n) => a + Number(n.volume_saldo_kg || 0), 0)

  const totalFat  = saidas.filter(s => s.tipo_saida === 'faturamento').reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)
  const totalDev  = saidas.filter(s => s.tipo_saida?.startsWith('dev_')).reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)
  const totalSuc  = saidas.filter(s => ['sucata', 'estopa'].includes(s.tipo_saida)).reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)
  const totalSaida = totalFat + totalDev + totalSuc

  // Detalhes devolução
  const devQual   = saidas.filter(s => s.tipo_saida === 'dev_qualidade').reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)
  const devProc   = saidas.filter(s => s.tipo_saida === 'dev_processo').reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)
  const devFinal  = saidas.filter(s => s.tipo_saida === 'dev_final_campanha').reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)
  // Detalhes sucata
  const soSucata  = saidas.filter(s => s.tipo_saida === 'sucata').reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)
  const soEstopa  = saidas.filter(s => s.tipo_saida === 'estopa').reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)

  const loteKpis  = calcKpiPorLote(nfs, saidas)

  if (loading) return <div className="loading"><div className="spinner" /><div>Carregando...</div></div>

  return (
    <div>
      <div className="page-header">
        <div className="page-title">KPIs <span>Façonagem</span></div>
        <div className="page-sub">Percentuais de faturamento, devolução e sucata vs entradas</div>
      </div>

      {/* ── Cards de resumo geral ── */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-label">Total Entrada</div>
          <div className="stat-value">{fmt(totalEntrada)}</div>
          <div className="stat-unit">kg em {nfs.length} NFs</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Saldo em Estoque</div>
          <div className="stat-value" style={{ color: 'var(--accent-2)' }}>{fmt(totalSaldo)}</div>
          <div className="stat-unit">{pct(totalSaldo, totalEntrada)}% do total</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Faturado</div>
          <div className="stat-value" style={{ color: 'var(--accent)' }}>{fmt(totalFat)}</div>
          <div className="stat-unit">{pct(totalFat, totalEntrada)}% das entradas</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sucata + Estopa</div>
          <div className="stat-value" style={{ color: 'var(--danger)' }}>{fmt(totalSuc)}</div>
          <div className="stat-unit">{pct(totalSuc, totalEntrada)}% das entradas</div>
        </div>
      </div>

      {/* ── Card principal — visão geral ── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-title">Visão Geral — Total Acumulado</div>
        <Legenda />

        {/* Barra geral */}
        <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--text-dim)' }}>
          Base: {fmt(totalEntrada)} kg entrada
        </div>
        <BarraSegmentada fat={totalFat} dev={totalDev} suc={totalSuc} outros={0} total={totalEntrada} />

        {/* Grid KPIs principais 2x2 */}
        <div className="kpi-grid-2">
          <KpiNum label="Faturamento"   valor={totalFat}   pctVal={pct(totalFat,   totalEntrada)} color="var(--accent)"   />
          <KpiNum label="Devolução"     valor={totalDev}   pctVal={pct(totalDev,   totalEntrada)} color="var(--accent-2)" />
          <KpiNum label="Sucata/Estopa" valor={totalSuc}   pctVal={pct(totalSuc,   totalEntrada)} color="var(--danger)"   />
          <KpiNum label="Saldo"         valor={totalSaldo} pctVal={pct(totalSaldo, totalEntrada)} color="var(--text-dim)" />
        </div>

        {/* Detalhamento devolução */}
        {totalDev > 0 && (
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '12px 14px', marginBottom: 12, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Detalhamento Devoluções
            </div>
            <div className="kpi-grid-2">
              {devQual  > 0 && <KpiNum label="Dev. Qualidade"      valor={devQual}  pctVal={pct(devQual,  totalEntrada)} color="var(--accent-2)" />}
              {devProc  > 0 && <KpiNum label="Dev. Processo"       valor={devProc}  pctVal={pct(devProc,  totalEntrada)} color="var(--accent-2)" />}
              {devFinal > 0 && <KpiNum label="Dev. Final Campanha" valor={devFinal} pctVal={pct(devFinal, totalEntrada)} color="var(--accent-2)" />}
            </div>
          </div>
        )}

        {/* Detalhamento sucata */}
        {totalSuc > 0 && (
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Detalhamento Sucata
            </div>
            <div className="kpi-grid-2">
              {soSucata > 0 && <KpiNum label="Sucata" valor={soSucata} pctVal={pct(soSucata, totalEntrada)} color="var(--danger)" />}
              {soEstopa > 0 && <KpiNum label="Estopa" valor={soEstopa} pctVal={pct(soEstopa, totalEntrada)} color="var(--warn)"   />}
            </div>
          </div>
        )}
      </div>

      {/* ── KPIs por Lote ── */}
      <div className="card">
        <div className="card-title">KPIs por Lote POY</div>
        <Legenda />
        {loteKpis.length === 0
          ? <div className="empty"><div className="empty-icon">📊</div><div className="empty-text">Nenhum dado encontrado</div></div>
          : loteKpis.map(g => <LoteKpiCard key={g.lote} g={g} />)
        }
      </div>
    </div>
  )
}
