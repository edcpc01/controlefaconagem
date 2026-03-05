import { useEffect, useRef, useState } from 'react'
import { salvarConfig, carregarConfig } from '../lib/faconagem'
import { useTheme } from '../lib/ThemeContext'
import { useAuth } from '../lib/AuthContext'
import { useUser, UNIDADES_DEFAULT } from '../lib/UserContext'
import { db } from '../lib/firebase'
import { doc, setDoc, getDocs, collection, Timestamp } from 'firebase/firestore'

function Toast({ toasts }) {
  return <div className="toast-container">{toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
}

function RoleBadge({ role }) {
  return role === 'admin'
    ? <span className="badge badge-blue" style={{fontSize:12}}>Admin</span>
    : <span className="badge badge-green" style={{fontSize:12}}>Analista</span>
}

export default function ConfigPage() {
  const { theme, toggle }      = useTheme()
  const { user, logout }       = useAuth()
  const { perfil, isAdmin, trocarUnidade, unidadeAtiva, listarUsuarios } = useUser() || {}

  const [logoBase64, setLogoBase64] = useState('')
  const [logoPreview, setLogoPreview] = useState('')
  const [saving, setSaving]         = useState(false)
  const [promovendo, setPromovendo] = useState(false)
  const [toasts, setToasts]         = useState([])
  const fileRef = useRef()

  const toast = (msg, type = 'success') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }

  useEffect(() => {
    carregarConfig().then(cfg => {
      if (cfg.logoBase64) { setLogoBase64(cfg.logoBase64); setLogoPreview(cfg.logoBase64) }
    })
  }, [])

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 300 * 1024) { toast('Imagem muito grande (máx 300 KB).', 'error'); return }
    const reader = new FileReader()
    reader.onload = (ev) => { setLogoPreview(ev.target.result); setLogoBase64(ev.target.result) }
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await salvarConfig({ logoBase64 })
      toast('Configurações salvas!')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Bootstrap Admin ───────────────────────────────────────────────────────
  // Permite que o usuário atual se torne admin se não houver nenhum admin no sistema
  const handleBootstrapAdmin = async () => {
    if (!user) return
    setPromovendo(true)
    try {
      // Verifica se já existe algum admin
      const todos = await getDocs(collection(db, 'usuarios'))
      const jaTemAdmin = todos.docs.some(d => d.data().role === 'admin')

      if (jaTemAdmin && !isAdmin) {
        toast('Já existe um administrador no sistema. Peça para ele promover sua conta.', 'error')
        setPromovendo(false)
        return
      }

      // Cria ou atualiza o perfil como admin
      await setDoc(doc(db, 'usuarios', user.uid), {
        email:      user.email,
        nome:       user.displayName || user.email,
        role:       'admin',
        unidade_id: '',
        criado_em:  Timestamp.now(),
      }, { merge: true })

      toast('✓ Sua conta agora é Administrador! A página será recarregada.')
      setTimeout(() => window.location.reload(), 1500)
    } catch (e) {
      toast('Erro: ' + e.message, 'error')
    } finally {
      setPromovendo(false)
    }
  }

  const roleLbl   = perfil?.role || 'analista'
  const unidadeLbl = UNIDADES_DEFAULT.find(u => u.id === (perfil?.unidade_id || unidadeAtiva))?.label

  return (
    <div>
      <div className="page-header">
        <div className="page-title">⚙ <span>Configurações</span></div>
        <div className="page-sub">Personalize o sistema e gerencie sua conta</div>
      </div>

      {/* ── Conta ── */}
      <div className="card" style={{marginBottom:20}}>
        <div className="card-title">Conta</div>
        <div style={{display:'flex', alignItems:'center', gap:16, flexWrap:'wrap'}}>
          {user?.photoURL && (
            <img src={user.photoURL} alt="avatar"
              style={{width:52, height:52, borderRadius:'50%', border:'2px solid var(--border)'}} />
          )}
          <div style={{flex:1}}>
            <div style={{fontWeight:700, fontSize:15, marginBottom:4}}>{user?.displayName || 'Usuário'}</div>
            <div style={{fontSize:13, color:'var(--text-dim)', marginBottom:6}}>{user?.email}</div>
            <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
              <RoleBadge role={roleLbl} />
              {unidadeLbl && (
                <span style={{fontSize:12, color:'var(--text-dim)'}}>🏭 {unidadeLbl}</span>
              )}
              {!unidadeLbl && roleLbl !== 'admin' && (
                <span style={{fontSize:12, color:'var(--warn)'}}>⚠ Sem unidade vinculada</span>
              )}
            </div>
          </div>
          <button className="btn btn-danger btn-sm" onClick={logout}>Sair</button>
        </div>

        {/* Bootstrap: se não for admin, mostra botão de autopromoção */}
        {roleLbl !== 'admin' && (
          <div style={{
            marginTop: 16, padding: '14px 16px',
            background: 'rgba(255,200,0,0.07)',
            border: '1px solid rgba(255,200,0,0.25)',
            borderRadius: 8
          }}>
            <div style={{fontWeight:600, fontSize:13, marginBottom:6, color:'var(--warn)'}}>
              ⚠ Sua conta está como Analista
            </div>
            <div style={{fontSize:12, color:'var(--text-dim)', marginBottom:12}}>
              Se você é o primeiro usuário ou o administrador do sistema, clique abaixo para elevar sua conta.
              Se já houver outro admin cadastrado, peça para ele promover você pela tela de Usuários.
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleBootstrapAdmin}
              disabled={promovendo}
            >
              {promovendo ? 'Verificando...' : '🔑 Tornar minha conta Administrador'}
            </button>
          </div>
        )}
      </div>

      {/* ── Aparência ── */}
      <div className="card" style={{marginBottom:20}}>
        <div className="card-title">Aparência</div>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div>
            <div style={{fontWeight:500, marginBottom:3}}>Tema</div>
            <div style={{fontSize:13, color:'var(--text-dim)'}}>Alterna entre modo escuro e claro</div>
          </div>
          <button className="theme-toggle" onClick={toggle} title="Alternar tema">
            <span className="theme-toggle-icon">{theme === 'dark' ? '☀' : '🌙'}</span>
            <span className="theme-toggle-track">
              <span className="theme-toggle-thumb"
                style={{transform: theme === 'light' ? 'translateX(22px)' : 'translateX(0)'}} />
            </span>
            <span style={{fontSize:12, color:'var(--text-dim)'}}>{theme === 'dark' ? 'Escuro' : 'Claro'}</span>
          </button>
        </div>
      </div>

      {/* ── Logo PDF ── */}
      <div className="card" style={{marginBottom:20}}>
        <div className="card-title">Logo do Romaneio PDF</div>
        <div style={{fontSize:13, color:'var(--text-dim)', marginBottom:16}}>
          A logo aparece no cabeçalho dos romaneios em PDF. Recomendado: PNG transparente, máx 300 KB.
        </div>

        <div style={{display:'flex', alignItems:'center', gap:20, flexWrap:'wrap'}}>
          <div className="logo-preview-box" onClick={() => fileRef.current?.click()}>
            {logoPreview
              ? <img src={logoPreview} alt="Logo" style={{maxWidth:'100%', maxHeight:'100%', objectFit:'contain'}} />
              : <div style={{textAlign:'center', color:'var(--text-dim)'}}>
                  <div style={{fontSize:28, marginBottom:6}}>🖼</div>
                  <div style={{fontSize:12}}>Clique para enviar</div>
                </div>
            }
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:10}}>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml"
              style={{display:'none'}} onChange={handleLogoChange} />
            <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>📁 Escolher imagem</button>
            {logoPreview && (
              <button className="btn btn-danger btn-sm" onClick={() => { setLogoBase64(''); setLogoPreview('') }}>
                ✕ Remover logo
              </button>
            )}
          </div>
        </div>

        <div style={{display:'flex', justifyContent:'flex-end', marginTop:20}}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando...' : '✓ Salvar Configurações'}
          </button>
        </div>
      </div>

      <Toast toasts={toasts} />
    </div>
  )
}
