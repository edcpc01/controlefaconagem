import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { buscarAlocacoesPorNF, listarHistoricoNF, TIPOS_SAIDA } from '../lib/faconagem'
import { db } from '../lib/firebase'
import { doc, getDoc } from 'firebase/firestore'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const fmt   = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtD  = d => { try { return format(new Date(d), 'dd/MM/yyyy') } catch { return '—' } }
const fmtDT = d => { try { return format(new Date(d), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) } catch { return '—' } }

function tipoBadge(tipo) {
  const map = {
    faturamento: 'badge-blue', sucata: 'badge-danger', estopa: 'badge-warn',
    dev_qualidade: 'badge-green', dev_processo: 'badge-green', dev_final_campanha: 'badge-green'
  }
  const label = TIPOS_SAIDA.find(t => t.value === tipo)?.label || tipo
  return <span className={`badge ${map[tipo] || 'badge-blue'}`}>{label}</span>
}

function tsToISO(ts) {
  if (!ts) return null
  if (ts?.toDate) return ts.toDate().toISOString()
  if (ts?.seconds) return new Date(ts.seconds * 1000).toISOString()
  return ts
}

export default function NFDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [nf,       setNf]      = useState(null)
  const [alocacoes, setAloc]   = useState([])
  const [historico, setHist]   = useState([])
  const [loading,  setLoading] = useState(true)
  const [erro,     setErro]    = useState('')

  useEffect(() => {
    async function carregar() {
      setLoading(true)
      setErro('')
      try {
        const nfSnap = await getDoc(doc(db, 'nf_entrada', id))
        if (!nfSnap.exists()) {
          setErro('NF não encontrada no banco de dados.')
          return
        }
        const d = nfSnap.data()
        setNf({
          id: nfSnap.id, ...d,
          data_emissao: tsToISO(d.data_emissao) || d.data_emissao,
          criado_em: tsToISO(d.criado_em),
        })
        const [alocs, hist] = await Promise.all([
          buscarAlocacoesPorNF(id),
          listarHistoricoNF(id),
        ])
        setAloc(alocs)
        setHist(hist)
      } catch (e) {
        setErro('Erro ao carregar NF: ' + e.message)
      } finally {
        setLoading(false)
      }
    }
    carregar()
  }, [id])

  if (loading) return <div className="loading"><div className="spinner"></div><div>Carregando...</div></div>

  if (erro) return (
    <div>
      <button className="btn btn-ghost btn-sm" style={{margin:'20px 0'}} onClick={() => navigate(-1)}>← Voltar</button>
      <div className="card"><div className="empty"><div className="empty-icon">⚠️</div><div className="empty-text">{erro}</div></div></div>
    </div>
  )

  if (!nf) return null

  const consumido  = Number(nf.volume_kg) - Number(nf.volume_saldo_kg)
  const pctConsumo = nf.volume_kg > 0 ? (consumido / nf.volume_kg) * 100 : 0
  const totalAloc  = alocacoes.reduce((s, a) => s + Number(a.volume_alocado_kg), 0)

  return (
    <div>
      <div className="page-header" style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12}}>
        <div>
          <button className="btn btn-ghost btn-sm" style={{marginBottom:10}} onClick={() => navigate(-1)}>← Voltar</button>
          <div className="page-title">NF <span>{nf.numero_nf}</span></div>
          <div className="page-sub">Rastreabilidade completa de consumo desta NF</div>
        </div>
      </div>

      <div className="stats-grid" style={{marginBottom:24}}>
        <div className="stat-card">
          <div className="stat-label">Volume Total Entrada</div>
          <div className="stat-value">{fmt(nf.volume_kg)}</div>
          <div className="stat-unit">kg</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Saldo Atual</div>
          <div className="stat-value" style={{color: Number(nf.volume_saldo_kg) <= 0.01 ? 'var(--danger)' : 'var(--accent-2)'}}>
            {fmt(nf.volume_saldo_kg)}
          </div>
          <div className="stat-unit">{Number(nf.volume_saldo_kg) <= 0.01 ? 'kg — Zerada' : 'kg — disponível'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Consumido</div>
          <div className="stat-value">{fmt(consumido)}</div>
          <div className="stat-unit">kg em {alocacoes.length} saída{alocacoes.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">% Consumido</div>
          <div className="stat-value">{pctConsumo.toFixed(1)}%</div>
          <div className="stat-unit">do volume total</div>
        </div>
      </div>

      <div className="card" style={{marginBottom:24}}>
        <div className="card-title">Dados da NF</div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:16, marginBottom:20}}>
          {[
            ['Emissão',        fmtD(nf.data_emissao)],
            ['Cód. Material',  nf.codigo_material || '—'],
            ['Lote POY',       nf.lote || '—'],
            ['Unidade',        nf.unidade_id || '—'],
            ['Valor Unitário', 'R$ ' + Number(nf.valor_unitario||0).toFixed(6).replace('.',',')],
            ['Valor Total',    'R$ ' + (Number(nf.volume_kg)*Number(nf.valor_unitario||0)).toLocaleString('pt-BR',{minimumFractionDigits:2})],
          ].map(([l, v]) => (
            <div key={l}>
              <div className="form-label" style={{marginBottom:4}}>{l}</div>
              <div style={{fontFamily:'monospace', fontSize:14, color:'var(--text)', fontWeight:600}}>{v}</div>
            </div>
          ))}
        </div>
        <div>
          <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--text-dim)', marginBottom:6}}>
            <span>Consumido: {fmt(consumido)} kg ({pctConsumo.toFixed(1)}%)</span>
            <span>Saldo: {fmt(nf.volume_saldo_kg)} kg</span>
          </div>
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{width:`${Math.min(pctConsumo,100)}%`, background: pctConsumo>=100 ? 'var(--danger)' : 'linear-gradient(90deg,var(--accent),var(--accent-2))'}} />
          </div>
        </div>
      </div>

      <div className="card" style={{marginBottom:24}}>
        <div className="card-title">
          Baixas realizadas nesta NF
          <span style={{fontSize:12, color:'var(--text-dim)', fontWeight:400, marginLeft:10}}>
            {alocacoes.length} operação{alocacoes.length !== 1 ? 'ões' : ''}
          </span>
        </div>
        {alocacoes.length === 0 ? (
          <div className="empty"><div className="empty-icon">📦</div><div className="empty-text">Nenhuma baixa realizada nesta NF ainda.</div></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Romaneio</th>
                  <th>Tipo</th>
                  <th className="col-hide-mobile">Cód. Material</th>
                  <th className="col-hide-mobile">Lote POY</th>
                  <th className="col-hide-mobile">Lote Acabado</th>
                  <th className="td-right">Abatido (kg)</th>
                  <th>Data/Hora</th>
                </tr>
              </thead>
              <tbody>
                {alocacoes.map(aloc => {
                  const s = aloc.saida
                  return (
                    <tr key={aloc.id}>
                      <td className="td-mono" style={{fontWeight:600}}>{s?.romaneio_microdata || '—'}</td>
                      <td>{s ? tipoBadge(s.tipo_saida) : '—'}</td>
                      <td className="col-hide-mobile" style={{fontSize:12}}>{s?.codigo_material || s?.codigo_produto || '—'}</td>
                      <td className="col-hide-mobile td-mono" style={{fontSize:12}}>{s?.lote_poy || s?.lote_produto || '—'}</td>
                      <td className="col-hide-mobile" style={{fontSize:12, color:'var(--text-dim)'}}>{s?.lote_acabado || '—'}</td>
                      <td className="td-right td-mono" style={{color:'var(--warn)', fontWeight:600}}>{fmt(aloc.volume_alocado_kg)}</td>
                      <td style={{fontSize:11, color:'var(--text-dim)', whiteSpace:'nowrap'}}>
                        {s?.criado_em ? fmtDT(s.criado_em) : aloc.criado_em ? fmtDT(aloc.criado_em) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{borderTop:'2px solid var(--border)'}}>
                  <td colSpan={5} style={{fontWeight:700, paddingTop:10}}>Total Abatido</td>
                  <td className="td-right td-mono" style={{fontWeight:700, color:'var(--warn)', paddingTop:10}}>{fmt(totalAloc)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {historico.length > 0 && (
        <div className="card">
          <div className="card-title">Histórico de Edições</div>
          <div style={{display:'flex', flexDirection:'column', gap:10}}>
            {historico.map(h => (
              <div key={h.id} style={{background:'rgba(255,255,255,0.04)', borderRadius:8, padding:'12px 14px', borderLeft:'3px solid var(--accent)'}}>
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:8, flexWrap:'wrap', gap:4}}>
                  <span style={{fontSize:12, fontWeight:600, color:'var(--accent)'}}>✏ {h.usuario_email}</span>
                  <span style={{fontSize:11, color:'var(--text-dim)'}}>{h.editado_em ? fmtDT(h.editado_em) : '—'}</span>
                </div>
                <div style={{display:'flex', flexDirection:'column', gap:4, fontSize:12}}>
                  {Object.entries(h.dados_depois || {}).map(([campo, novo]) => {
                    const antigo = h.dados_antes?.[campo]
                    if (String(antigo) === String(novo)) return null
                    return (
                      <div key={campo} style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                        <span style={{color:'var(--text-dim)', minWidth:110}}>{campo.replace(/_/g,' ')}:</span>
                        <span style={{color:'var(--danger)', textDecoration:'line-through'}}>{String(antigo)}</span>
                        <span style={{color:'var(--text-dim)'}}>→</span>
                        <span style={{color:'var(--accent-2)', fontWeight:600}}>{String(novo)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
