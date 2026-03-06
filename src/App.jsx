import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { ThemeProvider, useTheme } from './lib/ThemeContext'
import { UserProvider, useUser, UNIDADES_DEFAULT } from './lib/UserContext'
import EntradaPage   from './pages/EntradaPage'
import SaidaPage     from './pages/SaidaPage'
import DashboardPage from './pages/DashboardPage'
import NFDetailPage  from './pages/NFDetailPage'
import LogPage       from './pages/LogPage'
import ConfigPage    from './pages/ConfigPage'
import UsersPage     from './pages/UsersPage'
import LoginPage     from './pages/LoginPage'
import './index.css'

// ── PWA Install Banner ───────────────────────────────────────────
function PWAInstallBanner() {
  const [prompt, setPrompt] = useState(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault()
      setPrompt(e)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!visible || !prompt) return null

  return (
    <div className="pwa-install-banner">
      <span style={{fontSize:28}}>📱</span>
      <div className="pwa-text">
        <strong>Instalar App</strong>
        <span>Adicione à tela inicial para acesso rápido</span>
      </div>
      <button className="btn btn-primary btn-sm" onClick={async () => {
        prompt.prompt()
        await prompt.userChoice
        setVisible(false)
      }}>Instalar</button>
      <button className="btn btn-ghost btn-sm" onClick={() => setVisible(false)}>✕</button>
    </div>
  )
}

const NAV_BASE = [
  { to: '/',        label: 'Dashboard',  icon: '◈', end: true },
  { to: '/entrada', label: 'NF Entrada', icon: '↓' },
  { to: '/saida',   label: 'Saída',      icon: '↑' },
  { to: '/log',     label: 'Histórico',  icon: '📋' },
  { to: '/config',  label: 'Config',     icon: '⚙' },
]

// ── Seletor de Unidade no header ─────────────────────────────────
function UnidadeSelector() {
  const ctx = useUser()
  if (!ctx || !ctx.perfil) return null

  const { isAdmin, unidadeAtiva, trocarUnidade, perfil } = ctx

  if (!isAdmin) {
    const un = UNIDADES_DEFAULT.find(u => u.id === perfil.unidade_id)
    if (!un) return null
    return (
      <div className="unidade-badge" title="Sua unidade vinculada">
        <span>🏭</span>
        <span>{un.label}</span>
      </div>
    )
  }

  return (
    <div className="unidade-selector-wrap" title="Unidade ativa">
      <span>🏭</span>
      <select
        className="unidade-select"
        value={unidadeAtiva}
        onChange={e => trocarUnidade(e.target.value)}
      >
        <option value="">Todas as unidades</option>
        {UNIDADES_DEFAULT.map(u => (
          <option key={u.id} value={u.id}>{u.label}</option>
        ))}
      </select>
    </div>
  )
}

// ── Layout principal ─────────────────────────────────────────────
function Layout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { theme, toggle }       = useTheme()
  const { user, logout }        = useAuth()
  const ctx                     = useUser()
  const isAdmin                 = ctx?.isAdmin ?? false

  const navItems = isAdmin
    ? [...NAV_BASE, { to: '/usuarios', label: 'Usuários', icon: '👥' }]
    : NAV_BASE

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">

          {/* Brand */}
          <div className="header-brand">
            <span className="brand-icon">⬡</span>
            <div>
              <div className="brand-title">Façonagem</div>
              <div className="brand-sub">Rhodia</div>
            </div>
          </div>

          {/* Nav desktop */}
          <nav className="nav-desktop">
            {navItems.map(n => (
              <NavLink key={n.to} to={n.to} end={!!n.end}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">{n.icon}</span>{n.label}
              </NavLink>
            ))}
          </nav>

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="header-unit-selector">
              <UnidadeSelector />
            </div>
            <button className="btn-theme-icon" onClick={toggle} title="Alternar tema">
              {theme === 'dark' ? '☀' : '🌙'}
            </button>
            <div className="user-chip" title={`${ctx?.perfil?.role === 'admin' ? 'Admin' : 'Analista'} — ${user?.email}`}>
              {user?.photoURL
                ? <img src={user.photoURL} alt="" style={{ width: 26, height: 26, borderRadius: '50%' }} />
                : <span style={{ fontSize: 13 }}>{(user?.displayName || user?.email || '?')[0].toUpperCase()}</span>
              }
            </div>
            <button className="hamburger" onClick={() => setMenuOpen(o => !o)}>☰</button>
          </div>
        </div>

        {/* Nav mobile */}
        {menuOpen && (
          <nav className="nav-mobile">
            {navItems.map(n => (
              <NavLink key={n.to} to={n.to} end={!!n.end}
                className={({ isActive }) => `nav-link-mobile ${isActive ? 'active' : ''}`}
                onClick={() => setMenuOpen(false)}>
                <span className="nav-icon">{n.icon}</span> {n.label}
              </NavLink>
            ))}
            <div style={{ margin: '8px 0', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
              <UnidadeSelector />
            </div>
            <button className="btn btn-danger btn-sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={logout}>
              Sair
            </button>
          </nav>
        )}
      </header>
      <main className="main">{children}</main>
    </div>
  )
}

// ── Protected routes ─────────────────────────────────────────────
function ProtectedApp() {
  const { user }           = useAuth()
  const ctx                = useUser()
  const loadingPerfil      = ctx?.loadingPerfil ?? true

  // Auth loading
  if (user === undefined || (user !== null && loadingPerfil)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="loading"><div className="spinner" /><div>Carregando...</div></div>
      </div>
    )
  }

  if (user === null) return <LoginPage />

  return (
    <>
      <Layout>
        <Routes>
          <Route path="/"         element={<DashboardPage />} />
          <Route path="/entrada"  element={<EntradaPage />} />
          <Route path="/nf/:id"   element={<NFDetailPage />} />
          <Route path="/saida"    element={<SaidaPage />} />
          <Route path="/log"      element={<LogPage />} />
          <Route path="/config"   element={<ConfigPage />} />
          <Route path="/usuarios" element={<UsersPage />} />
          <Route path="*"         element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      <PWAInstallBanner />
    </>
  )
}

// Wrapper que injeta o firebaseUser no UserProvider
function AppWithUser() {
  const { user } = useAuth()
  return (
    <UserProvider firebaseUser={user ?? null}>
      <ProtectedApp />
    </UserProvider>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppWithUser />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}
