import { useEffect, useState } from 'react'
import { useUser, UNIDADES_DEFAULT } from '../lib/UserContext'

function Toast({ toasts }) {
  return <div className="toast-container">{toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
}

export default function UsersPage() {
  const { isAdmin, listarUsuarios, atualizarUsuario, perfil: meuperfil } = useUser()
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
    try { setUsuarios(await listarUsuarios()) }
    catch (e) { toast('Erro ao carregar usuários.', 'error') }
    finally { setLoading(false) }
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
            <div className="empty-text">Apenas administradores podem acessar esta tela.</div>
          </div>
        </div>
      </div>
    )
  }

  const handleUpdate = async (uid, campo, valor) => {
    setSalvando(uid + campo)
    try {
      await atualizarUsuario(uid, { [campo]: valor })
      setUsuarios(prev => prev.map(u => u.id === uid ? { ...u, [campo]: valor } : u))
      toast('Usuário atualizado.')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setSalvando(null)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">👥 <span>Gerenciar Usuários</span></div>
        <div className="page-sub">Defina o nível de acesso e a unidade de cada usuário</div>
      </div>

      <div className="card">
        <div className="card-title">Usuários do Sistema</div>

        {/* Legenda de roles */}
        <div style={{display:'flex', gap:16, marginBottom:20, flexWrap:'wrap'}}>
          <div style={{display:'flex', alignItems:'center', gap:8, fontSize:13}}>
            <span className="badge badge-blue">Admin</span>
            <span style={{color:'var(--text-dim)'}}>Acesso total, todas as unidades</span>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:8, fontSize:13}}>
            <span className="badge badge-green">Analista</span>
            <span style={{color:'var(--text-dim)'}}>Acesso limitado à unidade vinculada</span>
          </div>
        </div>

        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : usuarios.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">👥</div>
            <div className="empty-text">Nenhum usuário encontrado.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Nível</th>
                  <th>Unidade</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map(u => {
                  const ehEu = u.id === meuperfil?.uid || u.email === meuperfil?.email
                  const salvandoEste = salvando?.startsWith(u.id)
                  return (
                    <tr key={u.id}>
                      <td style={{fontWeight:600}}>{u.nome || '—'}</td>
                      <td style={{fontSize:12, color:'var(--text-dim)'}}>{u.email}</td>

                      {/* Role */}
                      <td>
                        {ehEu ? (
                          <span className="badge badge-blue">Admin (você)</span>
                        ) : (
                          <select
                            className="form-select"
                            style={{padding:'4px 8px', fontSize:12, width:110}}
                            value={u.role || 'analista'}
                            disabled={!!salvandoEste}
                            onChange={e => handleUpdate(u.id, 'role', e.target.value)}
                          >
                            <option value="admin">Admin</option>
                            <option value="analista">Analista</option>
                          </select>
                        )}
                      </td>

                      {/* Unidade */}
                      <td>
                        {u.role === 'admin' ? (
                          <span style={{fontSize:12, color:'var(--text-dim)'}}>Todas</span>
                        ) : (
                          <select
                            className="form-select"
                            style={{padding:'4px 8px', fontSize:12, width:180}}
                            value={u.unidade_id || ''}
                            disabled={!!salvandoEste}
                            onChange={e => handleUpdate(u.id, 'unidade_id', e.target.value)}
                          >
                            <option value="">— Sem unidade —</option>
                            {UNIDADES_DEFAULT.map(un => (
                              <option key={un.id} value={un.id}>{un.label}</option>
                            ))}
                          </select>
                        )}
                      </td>

                      <td>
                        {salvandoEste
                          ? <span style={{fontSize:11, color:'var(--accent)'}}>Salvando...</span>
                          : u.unidade_id || u.role === 'admin'
                            ? <span className="badge badge-green" style={{fontSize:10}}>✓ Configurado</span>
                            : <span className="badge badge-warn" style={{fontSize:10}}>⚠ Sem unidade</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{marginTop:16, padding:'12px 16px', background:'rgba(0,195,255,0.04)', border:'1px solid var(--border)', borderRadius:8, fontSize:12, color:'var(--text-dim)'}}>
          💡 Novos usuários são criados automaticamente como <strong style={{color:'var(--text)'}}>Analista</strong> no primeiro login. Apenas admins podem alterar o nível de acesso.
        </div>
      </div>

      <Toast toasts={toasts} />
    </div>
  )
}
