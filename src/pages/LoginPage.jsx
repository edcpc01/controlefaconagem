import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'

export default function LoginPage() {
  const { loginGoogle, loginEmail, cadastrarEmail, error, setError } = useAuth()
  const [mode, setMode]     = useState('login') // login | cadastro
  const [email, setEmail]   = useState('')
  const [senha, setSenha]   = useState('')
  const [nome, setNome]     = useState('')
  const [loading, setLoading] = useState(false)

  const handleEmail = async () => {
    if (!email || !senha) return
    setLoading(true)
    if (mode === 'login') await loginEmail(email, senha)
    else await cadastrarEmail(email, senha, nome)
    setLoading(false)
  }

  const handleGoogle = async () => {
    setLoading(true)
    await loginGoogle()
    setLoading(false)
  }

  const switchMode = () => { setError(null); setMode(m => m === 'login' ? 'cadastro' : 'login') }

  return (
    <div className="login-page">
      <div className="login-bg" />
      <div className="login-card">
        {/* Brand */}
        <div className="login-brand">
          <img src="/logo.svg" alt="Logo" style={{width:64,height:64,borderRadius:12,display:'block',margin:'0 auto 8px'}} />
          <div className="login-brand-title">Façonagem</div>
          <div className="login-brand-sub">Corradi Mazzer</div>
        </div>

        <div className="login-divider" />

        <div className="login-form-title">
          {mode === 'login' ? 'Entrar na conta' : 'Criar conta'}
        </div>

        {/* Google */}
        <button className="btn-google" onClick={handleGoogle} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continuar com Google
        </button>

        <div className="login-or"><span>ou</span></div>

        {/* Formulário */}
        {mode === 'cadastro' && (
          <div className="form-group" style={{marginBottom:12}}>
            <label className="form-label">Nome</label>
            <input className="form-input" type="text" placeholder="Seu nome" value={nome} onChange={e => setNome(e.target.value)} />
          </div>
        )}

        <div className="form-group" style={{marginBottom:12}}>
          <label className="form-label">E-mail</label>
          <input className="form-input" type="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleEmail()} />
        </div>

        <div className="form-group" style={{marginBottom:16}}>
          <label className="form-label">Senha</label>
          <input className="form-input" type="password" placeholder="••••••••" value={senha} onChange={e => setSenha(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleEmail()} />
        </div>

        {error && <div className="login-error">{error}</div>}

        <button className="btn btn-primary" style={{width:'100%', padding:'12px'}} onClick={handleEmail} disabled={loading || !email || !senha}>
          {loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
        </button>

        <div className="login-switch">
          {mode === 'login' ? 'Não tem conta?' : 'Já tem conta?'}
          <button onClick={switchMode}>{mode === 'login' ? 'Cadastre-se' : 'Entrar'}</button>
        </div>
      </div>
    </div>
  )
}
