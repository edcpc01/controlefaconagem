import { useEffect, useState } from 'react'
import { listarNFsEntrada, listarSaidas, gerarRelatorioPDF, TIPOS_SAIDA } from '../lib/faconagem'
import { useUser } from '../lib/UserContext'

const fmt  = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct  = (v, base) => base > 0 ? ((v / base) * 100).toFixed(1) : '0.0'
const pctN = (v, base) => base > 0 ? (v / base) * 100 : 0

const MESES = [
  { v: 0, l: 'Ano completo' },
  { v: 1, l: 'Janeiro' }, { v: 2, l: 'Fevereiro' }, { v: 3, l: 'Março' },
  { v: 4, l: 'Abril' },   { v: 5, l: 'Maio' },      { v: 6, l: 'Junho' },
  { v: 7, l: 'Julho' },   { v: 8, l: 'Agosto' },    { v: 9, l: 'Setembro' },
  { v: 10, l: 'Outubro' },{ v: 11, l: 'Novembro' }, { v: 12, l: 'Dezembro' },
]

function filtraPeriodo(items, campo, mes, ano) {
  return items.filter(i => {
    const d = new Date(i[campo])
    if (isNaN(d)) return false
    return mes === 0
      ? d.getFullYear() === ano
      : d.getMonth() + 1 === mes && d.getFullYear() === ano
  })
}

function labelTipo(tipo) {
  return TIPOS_SAIDA?.find(t => t.value === tipo)?.label || tipo
}

function Barra({ fat, dev, suc, base }) {
  if (!base) return null
  return (
    <div style={{ display:'flex', height:8, borderRadius:6, overflow:'hidden', background:'rgba(255,255,255,0.07)', margin:'10px 0' }}>
      {pctN(fat,base)>0 && <div style={{ width:`${pctN(fat,base)}%`, background:'var(--accent)' }} />}
      {pctN(dev,base)>0 && <div style={{ width:`${pctN(dev,base)}%`, background:'var(--accent-2)' }} />}
      {pctN(suc,base)>0 && <div style={{ width:`${pctN(suc,base)}%`, background:'var(--danger)' }} />}
    </div>
  )
}

function KpiPill({ label, kg, pctVal, color }) {
  return (
    <div style={{ background:'rgba(255,255,255,0.04)', borderRadius:10, padding:'10px 12px', flex:1, minWidth:0 }}>
      <div style={{ fontSize:10, color:'var(--text-dim)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:15, fontWeight:700, color: color || 'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{fmt(kg)}</div>
      <div style={{ fontSize:11, color: color || 'var(--text-dim)', marginTop:2 }}>kg · {pctVal}%</div>
    </div>
  )
}

const th = { padding:'6px 10px', textAlign:'left', color:'var(--text-dim)', fontWeight:600, fontSize:11 }
const td = { padding:'6px 10px', color:'var(--text)' }

function LoteCard({ lote, nfsPeriodo, saidasPeriodo }) {
  const [open, setOpen] = useState(false)

  const nfsLote    = nfsPeriodo.filter(n => (n.lote || '(sem lote)') === lote)
  const saidasLote = saidasPeriodo.filter(s => (s.lote_poy || s.lote_produto || '(sem lote)') === lote)

  const entradaKg = nfsLote.reduce((a, n) => a + Number(n.volume_kg || 0), 0)
  const fat = saidasLote.filter(s => s.tipo_saida === 'faturamento').reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)
  const dev = saidasLote.filter(s => s.tipo_saida?.startsWith('dev_')).reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)
  const suc = saidasLote.filter(s => ['sucata','estopa'].includes(s.tipo_saida)).reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)

  return (
    <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid var(--border)', borderRadius:14, marginBottom:14, overflow:'hidden' }}>
      <div style={{ padding:'14px 16px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:2 }}>
          <div style={{ fontWeight:700, fontSize:16 }}>
            Lote <span style={{ color:'var(--accent)' }}>{lote}</span>
          </div>
          <div style={{ fontSize:12, color:'var(--text-dim)' }}>
            {fmt(entradaKg)} kg entrada
          </div>
        </div>

        <Barra fat={fat} dev={dev} suc={suc} base={entradaKg} />

        <div style={{ display:'flex', gap:8 }}>
          <KpiPill label="Faturamento" kg={fat} pctVal={pct(fat, entradaKg)} color="var(--accent)"   />
          <KpiPill label="Devolução"   kg={dev} pctVal={pct(dev, entradaKg)} color="var(--accent-2)" />
          <KpiPill label="Sucata/Est." kg={suc} pctVal={pct(suc, entradaKg)} color="var(--danger)"   />
        </div>

        <button
          onClick={() => setOpen(o => !o)}
          style={{
            marginTop:12, background:'rgba(255,255,255,0.06)', border:'1px solid var(--border)',
            borderRadius:8, padding:'6px 14px', fontSize:12, color:'var(--text-dim)',
            cursor:'pointer', width:'100%'
          }}
        >
          {open ? '▲ Ocultar detalhes' : '▼ Ver entradas e saídas do período'}
        </button>
      </div>

      {open && (
        <div style={{ borderTop:'1px solid var(--border)', padding:'14px 16px', background:'rgba(0,0,0,0.15)' }}>

          <div style={{ fontSize:11, fontWeight:700, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>
            📥 Entradas do período
          </div>
          {nfsLote.length === 0
            ? <div style={{ fontSize:12, color:'var(--text-dim)', marginBottom:14 }}>Nenhuma NF de entrada no período</div>
            : (
              <div style={{ overflowX:'auto', marginBottom:16 }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'rgba(255,255,255,0.04)' }}>
                      <th style={th}>NF</th>
                      <th style={th}>Emissão</th>
                      <th style={th}>Cód.</th>
                      <th style={{...th, textAlign:'right'}}>kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nfsLote.map(n => (
                      <tr key={n.id} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                        <td style={td}>{n.numero_nf}</td>
                        <td style={td}>{n.data_emissao ? new Date(n.data_emissao).toLocaleDateString('pt-BR') : '—'}</td>
                        <td style={td}>{n.codigo_material || '—'}</td>
                        <td style={{...td, textAlign:'right', fontWeight:600}}>{fmt(n.volume_kg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }

          <div style={{ fontSize:11, fontWeight:700, color:'var(--accent-2)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>
            📤 Saídas do período
          </div>
          {saidasLote.length === 0
            ? <div style={{ fontSize:12, color:'var(--text-dim)' }}>Nenhuma saída no período</div>
            : (
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ background:'rgba(255,255,255,0.04)' }}>
                      <th style={th}>Romaneio</th>
                      <th style={th}>Tipo</th>
                      <th style={th}>Data</th>
                      <th style={{...th, textAlign:'right'}}>kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {saidasLote.map(s => (
                      <tr key={s.id} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                        <td style={td}>{s.romaneio_microdata || '—'}</td>
                        <td style={td}>
                          <span style={{
                            fontSize:10, padding:'2px 7px', borderRadius:99,
                            background: s.tipo_saida==='faturamento' ? 'rgba(0,180,255,0.15)'
                              : s.tipo_saida?.startsWith('dev_') ? 'rgba(0,220,130,0.15)'
                              : 'rgba(255,80,80,0.15)',
                            color: s.tipo_saida==='faturamento' ? 'var(--accent)'
                              : s.tipo_saida?.startsWith('dev_') ? 'var(--accent-2)'
                              : 'var(--danger)',
                          }}>
                            {labelTipo(s.tipo_saida)}
                          </span>
                        </td>
                        <td style={td}>{s.criado_em ? new Date(s.criado_em).toLocaleDateString('pt-BR') : '—'}</td>
                        <td style={{...td, textAlign:'right', fontWeight:600}}>{fmt(s.volume_abatido_kg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>
      )}
    </div>
  )
}

export default function KpisPage() {
  const { unidadeAtiva } = useUser() || {}
  const now = new Date()

  const [nfs,    setNfs]    = useState([])
  const [saidas, setSaidas] = useState([])
  const [loading,setLoading]= useState(true)
  const [mesSel, setMesSel] = useState(now.getMonth() + 1)
  const [anoSel, setAnoSel] = useState(now.getFullYear())
  const [gerando,setGerando]= useState(false)

  const anos = Array.from({ length: 4 }, (_, i) => now.getFullYear() - i)

  useEffect(() => {
    setLoading(true)
    Promise.all([listarNFsEntrada(unidadeAtiva || ''), listarSaidas(unidadeAtiva || '')])
      .then(([n, s]) => { setNfs(n); setSaidas(s) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [unidadeAtiva])

  const nfsPeriodo    = filtraPeriodo(nfs,    'data_emissao', mesSel, anoSel)
  const saidasPeriodo = filtraPeriodo(saidas, 'criado_em',    mesSel, anoSel)

  const totalEntrada = nfsPeriodo.reduce((a, n) => a + Number(n.volume_kg || 0), 0)
  const totalFat     = saidasPeriodo.filter(s => s.tipo_saida === 'faturamento').reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)
  const totalDev     = saidasPeriodo.filter(s => s.tipo_saida?.startsWith('dev_')).reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)
  const totalSuc     = saidasPeriodo.filter(s => ['sucata','estopa'].includes(s.tipo_saida)).reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)
  const devQual      = saidasPeriodo.filter(s => s.tipo_saida === 'dev_qualidade').reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)
  const devProc      = saidasPeriodo.filter(s => s.tipo_saida === 'dev_processo').reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)
  const devFinal     = saidasPeriodo.filter(s => s.tipo_saida === 'dev_final_campanha').reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)
  const soSucata     = saidasPeriodo.filter(s => s.tipo_saida === 'sucata').reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)
  const soEstopa     = saidasPeriodo.filter(s => s.tipo_saida === 'estopa').reduce((a, s) => a + Number(s.volume_abatido_kg || 0), 0)

  const lotesSet = new Set([
    ...nfsPeriodo.map(n => n.lote || '(sem lote)'),
    ...saidasPeriodo.map(s => s.lote_poy || s.lote_produto || '(sem lote)'),
  ])
  const lotes = [...lotesSet].sort()

  const handleGerarPDF = () => {
    setGerando(true)
    try { gerarRelatorioPDF(nfs, saidas, mesSel || null, anoSel) }
    finally { setTimeout(() => setGerando(false), 1000) }
  }

  const mesLabel = mesSel === 0
    ? `Ano ${anoSel}`
    : `${MESES.find(m => m.v === mesSel)?.l} / ${anoSel}`

  if (loading) return <div className="loading"><div className="spinner" /><div>Carregando...</div></div>

  return (
    <div>
      <div className="page-header">
        <div className="page-title">KPIs <span>Façonagem</span></div>
        <div className="page-sub">Percentuais por período · base = entradas de NF</div>
      </div>

      {/* ── Seletor de período ── */}
      <div className="card" style={{ marginBottom:20 }}>
        <div className="card-title" style={{ marginBottom:12 }}>📅 Período de análise</div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end' }}>
          <div style={{ flex:2, minWidth:140 }}>
            <div style={{ fontSize:11, color:'var(--text-dim)', marginBottom:4 }}>Mês</div>
            <select className="input" style={{ width:'100%' }} value={mesSel} onChange={e => setMesSel(Number(e.target.value))}>
              {MESES.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </div>
          <div style={{ flex:1, minWidth:90 }}>
            <div style={{ fontSize:11, color:'var(--text-dim)', marginBottom:4 }}>Ano</div>
            <select className="input" style={{ width:'100%' }} value={anoSel} onChange={e => setAnoSel(Number(e.target.value))}>
              {anos.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <button className="btn btn-secondary" onClick={handleGerarPDF} disabled={gerando} style={{ height:40, whiteSpace:'nowrap' }}>
            {gerando ? '⏳' : '📄'} PDF
          </button>
        </div>
      </div>

      {/* ── Consolidado do período ── */}
      <div className="card" style={{ marginBottom:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
          <div className="card-title" style={{ marginBottom:0 }}>Consolidado — {mesLabel}</div>
          <div style={{ fontSize:11, color:'var(--text-dim)' }}>{nfsPeriodo.length} NFs · {fmt(totalEntrada)} kg</div>
        </div>

        {totalEntrada === 0 ? (
          <div className="empty" style={{ padding:'20px 0' }}>
            <div className="empty-icon">📊</div>
            <div className="empty-text">Nenhuma entrada de NF no período selecionado</div>
          </div>
        ) : (
          <>
            <Barra fat={totalFat} dev={totalDev} suc={totalSuc} base={totalEntrada} />
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', fontSize:11, color:'var(--text-dim)', marginBottom:14 }}>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:8,height:8,borderRadius:2,background:'var(--accent)',display:'inline-block' }}/>Faturamento</span>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:8,height:8,borderRadius:2,background:'var(--accent-2)',display:'inline-block' }}/>Devolução</span>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:8,height:8,borderRadius:2,background:'var(--danger)',display:'inline-block' }}/>Sucata/Estopa</span>
            </div>

            <div style={{ display:'flex', gap:8, marginBottom:12 }}>
              <KpiPill label="Faturamento" kg={totalFat} pctVal={pct(totalFat, totalEntrada)} color="var(--accent)"   />
              <KpiPill label="Devolução"   kg={totalDev} pctVal={pct(totalDev, totalEntrada)} color="var(--accent-2)" />
              <KpiPill label="Sucata/Est." kg={totalSuc} pctVal={pct(totalSuc, totalEntrada)} color="var(--danger)"   />
            </div>

            {totalDev > 0 && (
              <div style={{ background:'rgba(255,255,255,0.03)', borderRadius:10, padding:'10px 12px', marginBottom:8, border:'1px solid var(--border)' }}>
                <div style={{ fontSize:11, fontWeight:600, color:'var(--accent-2)', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.05em' }}>↳ Devoluções</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  {devQual  > 0 && <KpiPill label="Qualidade"      kg={devQual}  pctVal={pct(devQual,  totalEntrada)} color="var(--accent-2)" />}
                  {devProc  > 0 && <KpiPill label="Processo"       kg={devProc}  pctVal={pct(devProc,  totalEntrada)} color="var(--accent-2)" />}
                  {devFinal > 0 && <KpiPill label="Final Campanha" kg={devFinal} pctVal={pct(devFinal, totalEntrada)} color="var(--accent-2)" />}
                </div>
              </div>
            )}

            {totalSuc > 0 && (
              <div style={{ background:'rgba(255,255,255,0.03)', borderRadius:10, padding:'10px 12px', border:'1px solid var(--border)' }}>
                <div style={{ fontSize:11, fontWeight:600, color:'var(--danger)', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.05em' }}>↳ Sucata/Estopa</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  {soSucata > 0 && <KpiPill label="Sucata" kg={soSucata} pctVal={pct(soSucata, totalEntrada)} color="var(--danger)" />}
                  {soEstopa > 0 && <KpiPill label="Estopa" kg={soEstopa} pctVal={pct(soEstopa, totalEntrada)} color="var(--warn)"   />}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Cards por lote ── */}
      <div className="card">
        <div className="card-title" style={{ marginBottom:16 }}>KPIs por Lote POY — {mesLabel}</div>
        {lotes.length === 0
          ? <div className="empty"><div className="empty-icon">📦</div><div className="empty-text">Nenhum lote no período</div></div>
          : lotes.map(lote => (
              <LoteCard key={lote} lote={lote} nfsPeriodo={nfsPeriodo} saidasPeriodo={saidasPeriodo} />
            ))
        }
      </div>
    </div>
  )
}
