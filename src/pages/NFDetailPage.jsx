import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { listarNFsEntrada, buscarAlocacoesPorNF, listarHistoricoNF, TIPOS_SAIDA, TIPOS_COM_ABATIMENTO } from '../lib/faconagem'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const fmt  = n => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtD = d => { try { return format(new Date(d), 'dd/MM/yyyy') } catch { return '—' } }
const fmtDT = d => { try { return format(new Date(d), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) } catch { return '—' } }

function tipoBadge(tipo) {
  const map = { faturamento:'badge-blue', sucata:'badge-danger', estopa:'badge-warn', dev_qualidade:'badge-green', dev_processo:'badge-green', dev_final_campanha:'badge-green' }
  const label = TIPOS_SAIDA.find(t => t.value === tipo)?.label || tipo
  return <span className={`badge ${map[tipo] || 'badge-blue'}`}>{label}</span>
}

export default function NFDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [nf, setNf]           = useState(null)
  const [alocacoes, setAloc]  = useState([])
  const [historico, setHist]  = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([listarNFsEntrada(), buscarAlocacoesPorNF(id), listarHistoricoNF(id)])
      .then(([nfs, alocs, hist]) => {
        setNf(nfs.find(n => n.id === id) || null)
        setAloc(alocs)
        setHist(hist)
      })
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="loading"><div className="spinner"></div></div>
  if (!nf)     return <div className="empty"><div className="empty-icon">🔍</div><div className="empty-text">NF não encontrada.</div></div>

  const consumido   = Number(nf.volume_kg) - Number(nf.volume_saldo_kg)
  const pctConsumo  = nf.volume_kg > 0 ? (consumido / nf.volume_kg) * 100 : 0
  const totalSaidas = alocacoes.reduce((s, a) => s + Number(a.volume_alocado_kg), 0)

  return (
    <div>
      <div className="page-header" style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12}}>
        <div>
          <button className="btn btn-ghost btn-sm" style={{marginBottom:10}} onClick={() => navigate('/entrada')}>
            ← Voltar
          </button>
          <div className="page-title">NF <span>{nf.numero_nf}</span></div>
          <div className="page-sub">Rastreabilidade completa de consumo desta NF</div>
        </div>
      </div>

      {/* Cards de resumo */}
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
          <div className="stat-unit">kg {Number(nf.volume_saldo_kg) <= 0.01 ? '— Zerada' : '— disponível'}</div>
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

      {/* Barra de progresso */}
      <div className="card" style={{marginBottom:24}}>
        <div className="card-title">Consumo da NF</div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:16, marginBottom:20}}>
          {[
            ['Emissão',         fmtD(nf.data_emissao)],
            ['Cód. Material',   nf.codigo_material],
            ['Lote',            nf.lote],
            ['Valor Unitário',  `R$ ${Number(nf.valor_unitario).toFixed(6).replace('.',',')}`],
            ['Valor Total',     `R$ ${(Number(nf.volume_kg)*Number(nf.valor_unitario)).toLocaleString('pt-BR',{minimumFractionDigits:2})}`],
          ].map(([l, v]) => (
            <div key={l}>
              <div className="form-label" style={{marginBottom:4}}>{l}</div>
              <div style={{fontFamily:'IBM Plex Mono, monospace', fontSize:14, color:'var(--text)'}}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{marginTop:8}}>
          <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--text-dim)', marginBottom:6}}>
            <span>Consumido: {fmt(consumido)} kg</span>
            <span>Saldo: {fmt(nf.volume_saldo_kg)} kg</span>
          </div>
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{width: `${Math.min(pctConsumo, 100)}%`, background: pctConsumo >= 100 ? 'var(--danger)' : 'linear-gradient(90deg, var(--accent), var(--accent-2))'}} />
          </div>
          <div style={{fontSize:11, color:'var(--text-dim)', marginTop:4, textAlign:'right'}}>{pctConsumo.toFixed(2)}% consumido</div>
        </div>
      </div>

      {/* Tabela de saídas que consumiram esta NF */}
      <div className="card">
        <div className="card-title">Saídas que consumiram esta NF</div>

        {alocacoes.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">📦</div>
            <div className="empty-text">Nenhuma saída consumiu esta NF ainda.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Romaneio</th>
                  <th>Tipo Saída</th>
                  <th>Cód. Produto</th>
                  <th>Lote</th>
                  <th className="td-right">Vol. Abatido (kg)</th>
                  <th>Data/Hora</th>
                </tr>
              </thead>
              <tbody>
                {alocacoes.map(aloc => (
                  <tr key={aloc.id}>
                    <td className="td-mono" style={{fontWeight:600}}>
                      {aloc.saida?.romaneio_microdata || '—'}
                    </td>
                    <td>{aloc.saida ? tipoBadge(aloc.saida.tipo_saida) : '—'}</td>
                    <td>{aloc.saida?.codigo_produto || '—'}</td>
                    <td>{aloc.saida?.lote_produto || '—'}</td>
                    <td className="td-right td-mono" style={{color:'var(--warn)', fontWeight:600}}>
                      {fmt(aloc.volume_alocado_kg)}
                    </td>
                    <td style={{fontSize:12, color:'var(--text-dim)'}}>
                      {aloc.saida?.criado_em ? fmtDT(aloc.saida.criado_em) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{fontWeight:700, color:'var(--text)', paddingTop:12}}>Total Consumido</td>
                  <td className="td-right td-mono" style={{fontWeight:700, color:'var(--warn)', paddingTop:12}}>{fmt(totalSaidas)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      {/* Histórico de Edições */}
      {historico.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-title">Histórico de Edições</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {historico.map(h => (
              <div key={h.id} style={{
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 8, padding: '12px 14px',
                borderLeft: '3px solid var(--accent)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>✏ Editado por {h.usuario_email}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{h.editado_em ? fmtDT(h.editado_em) : '—'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
                  {Object.entries(h.dados_depois || {}).map(([campo, novo]) => {
                    const antigo = h.dados_antes?.[campo]
                    const mudou  = String(antigo) !== String(novo)
                    if (!mudou) return null
                    return (
                      <div key={campo} style={{ gridColumn: 'span 2', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--text-dim)', minWidth: 110 }}>{campo.replace(/_/g, ' ')}:</span>
                        <span style={{ color: 'var(--danger)', textDecoration: 'line-through' }}>{String(antigo)}</span>
                        <span style={{ color: 'var(--text-dim)' }}>→</span>
                        <span style={{ color: 'var(--accent-2)', fontWeight: 600 }}>{String(novo)}</span>
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
