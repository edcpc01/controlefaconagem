import { useEffect, useState } from 'react'
import { listarLogs } from '../lib/faconagem'
import { useOperacao } from '../lib/OperacaoContext'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const ACAO_CONFIG = {
  NF_ENTRADA_CRIADA:   { icon: '↓', color: 'var(--accent-2)', label: 'NF Entrada' },
  NF_ENTRADA_REMOVIDA: { icon: '✕', color: 'var(--danger)',   label: 'NF Removida' },
  SAIDA_REGISTRADA:    { icon: '↑', color: 'var(--accent)',   label: 'Saída' },
}

export default function LogPage() {
  const { colecoes, operacaoAtiva } = useOperacao()
  const [logs, setLogs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca]     = useState('')

  useEffect(() => {
    setLoading(true)
    listarLogs(colecoes).then(setLogs).finally(() => setLoading(false))
  }, [operacaoAtiva])

  const filtered = logs.filter(l =>
    !busca ||
    l.descricao?.toLowerCase().includes(busca.toLowerCase()) ||
    l.usuario_email?.toLowerCase().includes(busca.toLowerCase()) ||
    l.usuario_nome?.toLowerCase().includes(busca.toLowerCase())
  )

  const fmtDT = d => { try { return format(new Date(d), "dd/MM/yyyy HH:mm:ss", { locale: ptBR }) } catch { return '—' } }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Histórico de <span>Ações</span></div>
        <div className="page-sub">Log completo de todas as operações realizadas no sistema</div>
      </div>

      <div className="card">
        <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:20, flexWrap:'wrap'}}>
          <div className="card-title" style={{margin:0, flex:1}}>Registro de Atividades</div>
          <input
            className="form-input"
            style={{maxWidth:280}}
            placeholder="Buscar por descrição ou usuário..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">📋</div>
            <div className="empty-text">{busca ? 'Nenhum resultado encontrado.' : 'Nenhuma ação registrada ainda.'}</div>
          </div>
        ) : (
          <div className="log-timeline">
            {filtered.map((log, i) => {
              const cfg = ACAO_CONFIG[log.acao] || { icon: '•', color: 'var(--text-dim)', label: log.acao }
              return (
                <div key={log.id} className="log-item">
                  <div className="log-dot" style={{background: cfg.color, boxShadow: `0 0 8px ${cfg.color}55`}}>
                    <span style={{fontSize:11}}>{cfg.icon}</span>
                  </div>
                  {i < filtered.length - 1 && <div className="log-line" />}
                  <div className="log-content">
                    <div className="log-header">
                      <span className="log-badge" style={{background: `${cfg.color}20`, color: cfg.color, border: `1px solid ${cfg.color}40`}}>
                        {cfg.label}
                      </span>
                      <span className="log-time">{fmtDT(log.criado_em)}</span>
                    </div>
                    <div className="log-desc">{log.descricao}</div>
                    <div className="log-user">
                      <span className="log-user-icon">👤</span>
                      {log.usuario_nome || log.usuario_email}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div style={{marginTop:16, padding:'8px 0', borderTop:'1px solid var(--border)', fontSize:12, color:'var(--text-dim)'}}>
            {filtered.length} registro{filtered.length !== 1 ? 's' : ''} encontrado{filtered.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  )
}
