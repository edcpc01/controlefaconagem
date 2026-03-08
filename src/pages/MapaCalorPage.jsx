import { useEffect, useState, useMemo } from 'react'
import { listarSaidas, TIPOS_SAIDA } from '../lib/faconagem'
import { useUser } from '../lib/UserContext'

const DIAS   = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const HORAS  = Array.from({ length: 24 }, (_, i) => i)
const fmt    = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function interpolarCor(valor, max) {
  if (max === 0 || valor === 0) return 'rgba(255,255,255,0.04)'
  const t = Math.min(valor / max, 1)
  // azul escuro → azul médio → cyan → verde
  const r = Math.round(10  + (0   - 10)  * t)
  const g = Math.round(40  + (195 - 40)  * t)
  const b = Math.round(100 + (100 - 100) * t)
  return `rgba(${r},${g},${b},${0.15 + t * 0.75})`
}

export default function MapaCalorPage() {
  const { unidadeAtiva } = useUser() || {}
  const [saidas,   setSaidas]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [metrica,  setMetrica]  = useState('volume')   // 'volume' | 'count'
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroDias, setFiltroDias] = useState(90)     // últimos N dias

  useEffect(() => {
    setLoading(true)
    listarSaidas(unidadeAtiva || '')
      .then(setSaidas)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [unidadeAtiva])

  // Filtra por período e tipo
  const saidasFiltradas = useMemo(() => {
    const corte = new Date(Date.now() - filtroDias * 24 * 60 * 60 * 1000)
    return saidas.filter(s => {
      if (!s.criado_em) return false
      if (new Date(s.criado_em) < corte) return false
      if (filtroTipo && s.tipo_saida !== filtroTipo) return false
      return true
    })
  }, [saidas, filtroDias, filtroTipo])

  // Constrói matriz [dia][hora]
  const matriz = useMemo(() => {
    const m = Array.from({ length: 7 }, () => Array(24).fill(0))
    for (const s of saidasFiltradas) {
      const d = new Date(s.criado_em)
      const dia  = d.getDay()
      const hora = d.getHours()
      m[dia][hora] += metrica === 'volume'
        ? Number(s.volume_abatido_kg || 0)
        : 1
    }
    return m
  }, [saidasFiltradas, metrica])

  const maxVal = useMemo(() => Math.max(...matriz.flat()), [matriz])

  // Totais por dia e por hora
  const totalPorDia  = useMemo(() => matriz.map(row => row.reduce((a, v) => a + v, 0)), [matriz])
  const totalPorHora = useMemo(() => HORAS.map(h => matriz.reduce((a, row) => a + row[h], 0)), [matriz])
  const totalGeral   = useMemo(() => totalPorDia.reduce((a, v) => a + v, 0), [totalPorDia])

  // Top 3 células
  const top3 = useMemo(() => {
    const cells = []
    for (let d = 0; d < 7; d++)
      for (let h = 0; h < 24; h++)
        if (matriz[d][h] > 0) cells.push({ d, h, v: matriz[d][h] })
    return cells.sort((a, b) => b.v - a.v).slice(0, 3)
  }, [matriz])

  if (loading) return <div className="loading"><div className="spinner" /><div>Carregando...</div></div>

  return (
    <div>
      <div className="page-header">
        <div className="page-title">🌡️ Mapa de <span>Calor</span></div>
        <div className="page-sub">Distribuição de saídas por dia da semana e hora do dia</div>
      </div>

      {/* Controles */}
      <div className="card" style={{ marginBottom: 20, padding: '14px 20px' }}>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ fontSize:12, color:'var(--text-dim)', fontWeight:600, marginRight:4 }}>FILTROS</div>

          <select className="form-select" style={{ maxWidth:160 }} value={filtroDias}
            onChange={e => setFiltroDias(Number(e.target.value))}>
            <option value={30}>Últimos 30 dias</option>
            <option value={60}>Últimos 60 dias</option>
            <option value={90}>Últimos 90 dias</option>
            <option value={180}>Últimos 6 meses</option>
            <option value={365}>Último ano</option>
            <option value={9999}>Todo o período</option>
          </select>

          <select className="form-select" style={{ maxWidth:200 }} value={filtroTipo}
            onChange={e => setFiltroTipo(e.target.value)}>
            <option value="">Todos os tipos</option>
            {TIPOS_SAIDA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          <div style={{ display:'flex', gap:0, borderRadius:8, overflow:'hidden', border:'1px solid var(--border)' }}>
            {[{k:'volume', l:'Volume kg'}, {k:'count', l:'Nº Saídas'}].map(o => (
              <button key={o.k} onClick={() => setMetrica(o.k)} style={{
                padding:'6px 14px', border:'none', cursor:'pointer', fontSize:12, fontWeight:600,
                background: metrica === o.k ? 'var(--accent)' : 'transparent',
                color: metrica === o.k ? '#fff' : 'var(--text-dim)',
              }}>{o.l}</button>
            ))}
          </div>

          <div style={{ marginLeft:'auto', fontSize:12, color:'var(--text-dim)' }}>
            <strong style={{ color:'var(--text)' }}>{saidasFiltradas.length}</strong> saídas ·{' '}
            <strong style={{ color:'var(--accent)' }}>{fmt(saidasFiltradas.reduce((a,s)=>a+Number(s.volume_abatido_kg||0),0))} kg</strong>
          </div>
        </div>
      </div>

      {/* Destaques */}
      {top3.length > 0 && (
        <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap' }}>
          {top3.map((c, i) => (
            <div key={i} className="card" style={{ flex:'1 1 180px', padding:'12px 16px', borderColor: i===0 ? 'var(--accent)' : 'var(--border)' }}>
              <div style={{ fontSize:11, color:'var(--text-dim)', marginBottom:4 }}>
                {i===0 ? '🏆 Pico máximo' : i===1 ? '🥈 2º maior' : '🥉 3º maior'}
              </div>
              <div style={{ fontWeight:700, fontSize:15 }}>{DIAS[c.d]} às {String(c.h).padStart(2,'0')}h</div>
              <div style={{ fontSize:13, color:'var(--accent)', fontWeight:600, marginTop:2 }}>
                {metrica === 'volume' ? fmt(c.v) + ' kg' : c.v + ' saída' + (c.v>1?'s':'')}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Heatmap principal */}
      <div className="card" style={{ overflowX:'auto' }}>
        <div className="card-title" style={{ marginBottom:16 }}>
          {metrica === 'volume' ? 'Volume por Dia × Hora (kg)' : 'Quantidade de Saídas por Dia × Hora'}
        </div>

        {saidasFiltradas.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">📊</div>
            <div className="empty-text">Nenhuma saída no período selecionado</div>
          </div>
        ) : (
          <div style={{ minWidth: 700 }}>
            {/* Legenda de horas */}
            <div style={{ display:'grid', gridTemplateColumns:'60px repeat(24, 1fr) 70px', gap:2, marginBottom:2 }}>
              <div />
              {HORAS.map(h => (
                <div key={h} style={{ textAlign:'center', fontSize:10, color:'var(--text-dim)', padding:'2px 0' }}>
                  {h % 3 === 0 ? String(h).padStart(2,'0') : ''}
                </div>
              ))}
              <div style={{ textAlign:'center', fontSize:10, color:'var(--text-dim)' }}>Total</div>
            </div>

            {/* Linhas por dia */}
            {DIAS.map((dia, d) => (
              <div key={d} style={{ display:'grid', gridTemplateColumns:'60px repeat(24, 1fr) 70px', gap:2, marginBottom:2 }}>
                <div style={{ display:'flex', alignItems:'center', fontSize:12, fontWeight:600, color:'var(--text-dim)', paddingRight:8 }}>
                  {dia}
                </div>
                {HORAS.map(h => {
                  const val = matriz[d][h]
                  return (
                    <div
                      key={h}
                      title={val > 0 ? `${dia} ${String(h).padStart(2,'0')}h: ${metrica==='volume' ? fmt(val)+' kg' : val+' saída(s)'}` : ''}
                      style={{
                        height: 32, borderRadius:4,
                        background: interpolarCor(val, maxVal),
                        border: val > 0 ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(255,255,255,0.03)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        cursor: val > 0 ? 'default' : 'default',
                        transition:'transform 0.1s',
                      }}
                      onMouseEnter={e => { if(val>0) e.currentTarget.style.transform='scale(1.15)'; e.currentTarget.style.zIndex=10 }}
                      onMouseLeave={e => { e.currentTarget.style.transform='scale(1)'; e.currentTarget.style.zIndex=1 }}
                    >
                      {val > 0 && maxVal > 0 && (val / maxVal) > 0.3 && (
                        <span style={{ fontSize:8, fontWeight:700, color:'rgba(255,255,255,0.85)', lineHeight:1 }}>
                          {metrica==='volume' ? Math.round(val) : val}
                        </span>
                      )}
                    </div>
                  )
                })}
                {/* Total do dia */}
                <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', fontSize:11, fontWeight:600, color:'var(--accent-2)', paddingLeft:6 }}>
                  {metrica==='volume' ? fmt(totalPorDia[d]) : totalPorDia[d]}
                </div>
              </div>
            ))}

            {/* Totais por hora */}
            <div style={{ display:'grid', gridTemplateColumns:'60px repeat(24, 1fr) 70px', gap:2, marginTop:6, borderTop:'1px solid var(--border)', paddingTop:6 }}>
              <div style={{ fontSize:11, color:'var(--text-dim)', display:'flex', alignItems:'center' }}>Total</div>
              {HORAS.map(h => (
                <div key={h} style={{ textAlign:'center', fontSize:9, color: totalPorHora[h] > 0 ? 'var(--accent)' : 'var(--text-dim)', fontWeight:600 }}>
                  {totalPorHora[h] > 0 ? (metrica==='volume' ? Math.round(totalPorHora[h]) : totalPorHora[h]) : ''}
                </div>
              ))}
              <div style={{ textAlign:'right', fontSize:11, fontWeight:700, color:'var(--accent)', paddingLeft:6 }}>
                {metrica==='volume' ? fmt(totalGeral) : totalGeral}
              </div>
            </div>

            {/* Legenda de cor */}
            <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:16, justifyContent:'flex-end' }}>
              <span style={{ fontSize:11, color:'var(--text-dim)' }}>Baixo</span>
              {[0.1,0.25,0.5,0.75,1].map(t => (
                <div key={t} style={{ width:24, height:14, borderRadius:3, background: interpolarCor(t * maxVal, maxVal) }} />
              ))}
              <span style={{ fontSize:11, color:'var(--text-dim)' }}>Alto</span>
            </div>
          </div>
        )}
      </div>

      {/* Ranking por dia */}
      {totalGeral > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:16 }}>
          <div className="card">
            <div className="card-title" style={{ marginBottom:12 }}>Por dia da semana</div>
            {DIAS.map((dia, d) => {
              const pct = totalGeral > 0 ? (totalPorDia[d] / totalGeral) * 100 : 0
              return (
                <div key={d} style={{ marginBottom:8 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:3 }}>
                    <span style={{ fontWeight:600 }}>{dia}</span>
                    <span style={{ color:'var(--accent)', fontFamily:'monospace' }}>
                      {metrica==='volume' ? fmt(totalPorDia[d])+' kg' : totalPorDia[d]+' saídas'} ({pct.toFixed(1)}%)
                    </span>
                  </div>
                  <div style={{ height:6, background:'rgba(255,255,255,0.06)', borderRadius:99, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${pct}%`, background:'var(--accent)', borderRadius:99, transition:'width 0.5s' }} />
                  </div>
                </div>
              )
            })}
          </div>

          <div className="card">
            <div className="card-title" style={{ marginBottom:12 }}>Por turno</div>
            {[
              { label:'🌅 Madrugada', h:[0,1,2,3,4,5], cor:'#6c7fd8' },
              { label:'☀️ Manhã',     h:[6,7,8,9,10,11], cor:'#f5a623' },
              { label:'🌤️ Tarde',     h:[12,13,14,15,16,17], cor:'#4ecdc4' },
              { label:'🌙 Noite',     h:[18,19,20,21,22,23], cor:'#a78bfa' },
            ].map(turno => {
              const vol = turno.h.reduce((a, h) => a + totalPorHora[h], 0)
              const pct = totalGeral > 0 ? (vol / totalGeral) * 100 : 0
              return (
                <div key={turno.label} style={{ marginBottom:10 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:3 }}>
                    <span style={{ fontWeight:600 }}>{turno.label}</span>
                    <span style={{ color: turno.cor, fontFamily:'monospace' }}>
                      {metrica==='volume' ? fmt(vol)+' kg' : vol+' saídas'} ({pct.toFixed(1)}%)
                    </span>
                  </div>
                  <div style={{ height:6, background:'rgba(255,255,255,0.06)', borderRadius:99, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${pct}%`, background: turno.cor, borderRadius:99, transition:'width 0.5s' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
