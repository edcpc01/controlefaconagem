import { useEffect, useState } from 'react'
import { useUser, UNIDADES_DEFAULT } from '../lib/UserContext'
import { useAuth } from '../lib/AuthContext'

function Toast({ toasts }) {
  return <div className="toast-container">{toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
}

function RoleBadge({ role }) {
  if (role === 'admin')             return <span className="badge badge-blue">Admin</span>
  if (role === 'supervisor_rhodia') return <span className="badge badge-warn">Sup. Rhodia</span>
  if (role === 'supervisor_nilit')  return <span className="badge badge-green">Sup. Nilit</span>
  if (role === 'pendente')          return <span className="badge badge-danger" style={{animation:'pulse 1.5s infinite'}}>⏳ Pendente</span>
  return <span className="badge" style={{background:'rgba(180,180,180,0.15)',color:'var(--text-dim)'}}>Analista</span>
}

export default function UsersPage() {
  const { isAdmin, listarUsuarios, atualizarUsuario, perfil: meuPerfil } = useUser()
  const { user: firebaseUser } = useAuth()
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading]   = useState(true)
  const [salvando, setSalvando] = useState(null)
  const [toasts, setToasts]     = useState([])

  const toast = (msg, type = 'success') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }

  const load = async () => {
    try {
      const lista = await listarUsuarios()
      // Garante que o usuário atual apareça primeiro
      lista.sort((a, b) => {
        if (a.email === firebaseUser?.email) return -1
        if (b.email === firebaseUser?.email) return 1
        return (a.nome || '').localeCompare(b.nome || '')
      })
      setUsuarios(lista)
    } catch (e) {
      toast('Erro ao carregar usuários: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (isAdmin) load() }, [isAdmin])

  if (!isAdmin) {
    return (
      <div>
        <div className="page-header">
          <div className="page-title">👥 <span>Usuários</span></div>
        </div>
        <div className="card">
          <div className="empty">
            <div className="empty-icon">🔒</div>
            <div className="empty-text">Apenas administradores têm acesso a esta página.</div>
          </div>
        </div>
      </div>
    )
  }

  const handleUpdate = async (uid, campo, valor) => {
    const key = uid + campo
    setSalvando(key)
    try {
      await atualizarUsuario(uid, { [campo]: valor })
      setUsuarios(prev => prev.map(u => u.id === uid ? { ...u, [campo]: valor } : u))
      toast('Salvo.')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setSalvando(null)
    }
  }

  const ehEu = (u) => u.email === firebaseUser?.email

  return (
    <div>
      <div className="page-header">
        <div className="page-title">👥 <span>Gerenciar Usuários</span></div>
        <div className="page-sub">Defina o nível de acesso e a unidade de façonagem de cada usuário</div>
      </div>

      {/* Regras resumidas */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">Níveis de Acesso</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ padding: '14px 16px', background: 'rgba(34,85,184,0.12)', borderRadius: 8, border: '1px solid rgba(34,85,184,0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <RoleBadge role="admin" />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Administrador</span>
            </div>
            <ul style={{ margin: 0, padding: '0 0 0 16px', color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.8 }}>
              <li>Acesso total ao sistema</li>
              <li>Visualiza todas as operações e unidades</li>
              <li>Gerencia usuários e permissões</li>
            </ul>
          </div>
          <div style={{ padding: '14px 16px', background: 'rgba(255,180,0,0.08)', borderRadius: 8, border: '1px solid rgba(255,180,0,0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <RoleBadge role="supervisor_rhodia" />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Supervisor Rhodia</span>
            </div>
            <ul style={{ margin: 0, padding: '0 0 0 16px', color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.8 }}>
              <li>Visualização da operação Rhodia</li>
              <li>Acesso a Dashboard, KPIs, Inventário</li>
              <li>Sem registro de entradas/saídas</li>
            </ul>
          </div>
          <div style={{ padding: '14px 16px', background: 'rgba(14,124,107,0.10)', borderRadius: 8, border: '1px solid rgba(14,124,107,0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <RoleBadge role="supervisor_nilit" />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Supervisor Nilit</span>
            </div>
            <ul style={{ margin: 0, padding: '0 0 0 16px', color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.8 }}>
              <li>Visualização da operação Nilit</li>
              <li>Acesso a Dashboard, KPIs, Inventário</li>
              <li>Sem registro de entradas/saídas</li>
            </ul>
          </div>
          <div style={{ padding: '14px 16px', background: 'rgba(180,180,180,0.08)', borderRadius: 8, border: '1px solid rgba(180,180,180,0.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <RoleBadge role="analista" />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Analista</span>
            </div>
            <ul style={{ margin: 0, padding: '0 0 0 16px', color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.8 }}>
              <li>Acesso às operações do dia a dia</li>
              <li>Seleciona operação no header</li>
              <li>Vinculado à unidade cadastrada</li>
              <li>Nível padrão para novos cadastros</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Tabela de usuários */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div className="card-title" style={{ margin: 0 }}>Usuários Cadastrados</div>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{usuarios.length} usuário{usuarios.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="loading"><div className="spinner" /></div>
        ) : usuarios.length === 0 ? (
          <div className="empty"><div className="empty-icon">👥</div><div className="empty-text">Nenhum usuário encontrado.</div></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th style={{ width: 140 }}>Nível</th>
                  <th style={{ width: 200 }}>Unidade</th>
                  <th style={{ width: 110 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map(u => {
                  const eu         = ehEu(u)
                  const salvandoEu = salvando?.startsWith(u.id)
                  return (
                    <tr key={u.id} style={{ background: u.role === 'pendente' ? 'rgba(255,60,60,0.06)' : eu ? 'rgba(0,195,255,0.04)' : undefined }}>
                      <td>
                        <span style={{ fontWeight: 600 }}>{u.nome || '—'}</span>
                        {eu && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--accent)', background: 'rgba(0,195,255,0.12)', padding: '1px 6px', borderRadius: 10 }}>você</span>}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{u.email}</td>

                      {/* Nível — admin não pode rebaixar a si mesmo */}
                      <td>
                        {eu ? (
                          <RoleBadge role={u.role || 'analista'} />
                        ) : (
                          <select
                            className="form-select"
                            style={{ padding: '4px 8px', fontSize: 12 }}
                            value={u.role || 'analista'}
                            disabled={!!salvandoEu}
                            onChange={e => handleUpdate(u.id, 'role', e.target.value)}
                          >
                            <option value="pendente">⏳ Pendente</option>
                            <option value="analista">Analista</option>
                            <option value="supervisor_rhodia">Supervisor Rhodia</option>
                            <option value="supervisor_nilit">Supervisor Nilit</option>
                            <option value="admin">Admin</option>
                          </select>
                        )}
                      </td>

                      {/* Unidade — não se aplica a admin nem supervisor */}
                      <td>
                        {(u.role === 'admin' || u.role === 'supervisor_rhodia' || u.role === 'supervisor_nilit') ? (
                          <span style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                            {u.role === 'admin' ? 'Todas' : u.role === 'supervisor_rhodia' ? 'Rhodia' : 'Nilit'}
                          </span>
                        ) : (
                          <select
                            className="form-select"
                            style={{ padding: '4px 8px', fontSize: 12 }}
                            value={u.unidade_id || ''}
                            disabled={!!salvandoEu}
                            onChange={e => handleUpdate(u.id, 'unidade_id', e.target.value)}
                          >
                            <option value="">— Não definida —</option>
                            {UNIDADES_DEFAULT.map(un => (
                              <option key={un.id} value={un.id}>{un.label}</option>
                            ))}
                          </select>
                        )}
                      </td>

                      {/* Status */}
                      <td>
                        {salvandoEu ? (
                          <span style={{ fontSize: 11, color: 'var(--accent)' }}>Salvando...</span>
                        ) : u.role === 'admin' || u.role === 'supervisor_rhodia' || u.role === 'supervisor_nilit' || u.unidade_id ? (
                          <span className="badge badge-green" style={{ fontSize: 10 }}>✓ OK</span>
                        ) : (
                          <span className="badge badge-warn" style={{ fontSize: 10 }}>⚠ Sem unidade</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-dim)' }}>
          💡 Todo usuário que faz login pela primeira vez é criado automaticamente como <strong style={{ color: 'var(--text)' }}>Analista</strong>. Somente um Admin pode alterar o nível.
        </div>
      </div>

      <Toast toasts={toasts} />
    </div>
  )
}
