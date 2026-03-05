import { useEffect, useRef, useState } from 'react'
import { salvarConfig, carregarConfig } from '../lib/faconagem'
import { useTheme } from '../lib/ThemeContext'
import { useAuth } from '../lib/AuthContext'

function Toast({ toasts }) {
  return <div className="toast-container">{toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
}

export default function ConfigPage() {
  const { theme, toggle } = useTheme()
  const { user, logout }  = useAuth()
  const [logoBase64, setLogoBase64] = useState('')
  const [logoPreview, setLogoPreview] = useState('')
  const [saving, setSaving] = useState(false)
  const [toasts, setToasts] = useState([])
  const fileRef = useRef()

  const toast = (msg, type = 'success') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
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

  const handleRemoveLogo = () => { setLogoBase64(''); setLogoPreview('') }

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

  return (
    <div>
      <div className="page-header">
        <div className="page-title">⚙ <span>Configurações</span></div>
        <div className="page-sub">Personalize o sistema e gerencie sua conta</div>
      </div>

      {/* Conta */}
      <div className="card" style={{marginBottom:20}}>
        <div className="card-title">Conta</div>
        <div style={{display:'flex', alignItems:'center', gap:16, flexWrap:'wrap'}}>
          {user?.photoURL && <img src={user.photoURL} alt="avatar" style={{width:48, height:48, borderRadius:'50%', border:'2px solid var(--border)'}} />}
          <div style={{flex:1}}>
            <div style={{fontWeight:600, fontSize:15}}>{user?.displayName || 'Usuário'}</div>
            <div style={{fontSize:13, color:'var(--text-dim)'}}>{user?.email}</div>
          </div>
          <button className="btn btn-danger btn-sm" onClick={logout}>Sair</button>
        </div>
      </div>

      {/* Tema */}
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
              <span className="theme-toggle-thumb" style={{transform: theme === 'light' ? 'translateX(22px)' : 'translateX(0)'}} />
            </span>
            <span style={{fontSize:12, color:'var(--text-dim)'}}>{theme === 'dark' ? 'Escuro' : 'Claro'}</span>
          </button>
        </div>
      </div>

      {/* Logo */}
      <div className="card" style={{marginBottom:20}}>
        <div className="card-title">Logo do Romaneio PDF</div>
        <div style={{fontSize:13, color:'var(--text-dim)', marginBottom:16}}>
          A logo aparece no canto esquerdo do cabeçalho dos romaneios em PDF. Recomendado: PNG transparente, máx 300 KB.
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
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml" style={{display:'none'}} onChange={handleLogoChange} />
            <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>📁 Escolher imagem</button>
            {logoPreview && <button className="btn btn-danger btn-sm" onClick={handleRemoveLogo}>✕ Remover logo</button>}
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
