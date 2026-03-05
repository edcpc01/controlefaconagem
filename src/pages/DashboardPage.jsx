import { useEffect, useState } from 'react'
import { listarNFsEntrada, listarSaidas, TIPOS_SAIDA } from '../lib/faconagem'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

function fmt(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function tipoBadge(tipo) {
  const map = {
    faturamento: 'badge-blue',
    sucata: 'badge-danger',
    estopa: 'badge-warn',
    dev_qualidade: 'badge-green',
    dev_processo: 'badge-green',
    dev_final_campanha: 'badge-green',
  }
  const label = TIPOS_SAIDA.find(t => t.value === tipo)?.label || tipo
  return <span className={`badge ${map[tipo] || 'badge-blue'}`}>{label}</span>
}

export default function DashboardPage() {
  const [nfs, setNfs] = useState([])
  const [saidas, setSaidas] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([listarNFsEntrada(), listarSaidas()])
      .then(([n, s]) => { setNfs(n); setSaidas(s) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const totalEntrada = nfs.reduce((a, n) => a + Number(n.volume_kg), 0)
  const totalSaldo = nfs.reduce((a, n) => a + Number(n.volume_saldo_kg), 0)
  const totalSaida = saidas.reduce((a, s) => a + Number(s.volume_abatido_kg), 0)
  const nfsZeradas = nfs.filter(n => Number(n.volume_saldo_kg) <= 0).length

  if (loading) return <div className="loading"><div className="spinner"></div><div>Carregando...</div></div>

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Dashboard <span>Façonagem</span></div>
        <div className="page-sub">Visão geral do controle de entradas e saídas</div>
      </div>

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
          <div className="stat-value">{nfsZeradas}</div>
          <div className="stat-unit">de {nfs.length} NFs</div>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, marginBottom:24}}>
        {/* NFs de Entrada */}
        <div className="card" style={{gridColumn: window.innerWidth < 768 ? '1/-1' : 'auto'}}>
          <div className="card-title">NFs de Entrada — Saldo</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>NF</th>
                  <th>Emissão</th>
                  <th className="td-right">Saldo (kg)</th>
                </tr>
              </thead>
              <tbody>
                {nfs.length === 0 && (
                  <tr><td colSpan={3}><div className="empty"><div className="empty-icon">📦</div><div className="empty-text">Nenhuma NF cadastrada</div></div></td></tr>
                )}
                {nfs.map(nf => (
                  <tr key={nf.id}>
                    <td className="td-mono">{nf.numero_nf}</td>
                    <td>{format(new Date(nf.data_emissao), 'dd/MM/yyyy')}</td>
                    <td className={`td-right td-mono ${Number(nf.volume_saldo_kg) <= 0 ? '' : ''}`}
                      style={{color: Number(nf.volume_saldo_kg) <= 0 ? 'var(--danger)' : 'var(--accent-2)'}}>
                      {fmt(nf.volume_saldo_kg)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Últimas Saídas */}
        <div className="card" style={{gridColumn: window.innerWidth < 768 ? '1/-1' : 'auto'}}>
          <div className="card-title">Últimas Saídas</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Romaneio</th>
                  <th>Tipo</th>
                  <th className="td-right">Volume (kg)</th>
                </tr>
              </thead>
              <tbody>
                {saidas.length === 0 && (
                  <tr><td colSpan={3}><div className="empty"><div className="empty-icon">📋</div><div className="empty-text">Nenhuma saída registrada</div></div></td></tr>
                )}
                {saidas.slice(0, 8).map(s => (
                  <tr key={s.id}>
                    <td className="td-mono">{s.romaneio_microdata}</td>
                    <td>{tipoBadge(s.tipo_saida)}</td>
                    <td className="td-right td-mono">{fmt(s.volume_abatido_kg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
