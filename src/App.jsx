import { useState } from 'react'
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

const NAV_ITEMS = [
  { to: '/',        label: 'Dashboard',  icon: '◈', end: true },
  { to: '/entrada', label: 'NF Entrada', icon: '↓' },
  { to: '/saida',   label: 'Saída',      icon: '↑' },
  { to: '/log',     label: 'Histórico',  icon: '📋' },
  { to: '/config',  label: 'Config',     icon: '⚙' },
]

// ── Seletor de Unidade (header) ────────────────────────────────────────────
function UnidadeSelector() {
  const { isAdmin, unidadeAtiva, trocarUnidade, perfil } = useUser()

  if (!isAdmin) {
    // Analista: mostra apenas o nome da unidade vinculada (não clicável)
    const un = UNIDADES_DEFAULT.find(u => u.id === perfil?.unidade_id)
    if (!un) return null
    return (
      <div className="unidade-badge" title="Sua unidade">
        <span className="unidade-icon">🏭</span>
        <span>{un.label}</span>
      </div>
    )
  }

  // Admin: dropdown para trocar a unidade ativa
  return (
    <div className="unidade-selector-wrap" title="Selecionar unidade ativa">
      <span className="unidade-icon">🏭</span>
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

// ── Layout ────────────────────────────────────────────────────────────────
function Layout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { theme, toggle }       = useTheme()
  const { user, logout }        = useAuth()
  const { isAdmin }             = useUser()

  const navItems = isAdmin
    ? [...NAV_ITEMS, { to: '/usuarios', label: 'Usuários', icon: '👥' }]
    : NAV_ITEMS

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <span className="brand-icon">⬡</span>
            <div>
              <div className="brand-title">Façonagem</div>
              <div className="brand-sub">Rhodia</div>
            </div>
          </div>

          <nav className="nav-desktop">
            {navItems.map(n => (
              <NavLink key={n.to} to={n.to} end={!!n.end}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">{n.icon}</span>{n.label}
              </NavLink>
            ))}
          </nav>

          <div style={{display:'flex', alignItems:'center', gap:8}}>
            {/* Seletor de unidade — fica ao lado do botão de tema */}
            <UnidadeSelector />

            <button className="btn-theme-icon" onClick={toggle} title="Alternar tema">
              {theme === 'dark' ? '☀' : '🌙'}
            </button>

            <div className="user-chip" title={user?.email}>
              {user?.photoURL
                ? <img src={user.photoURL} alt="" style={{width:26, height:26, borderRadius:'50%'}} />
                : <span style={{fontSize:13}}>{(user?.displayName || user?.email || '?')[0].toUpperCase()}</span>
              }
            </div>

            <button className="hamburger" onClick={() => setMenuOpen(o => !o)}>☰</button>
          </div>
        </div>

        {menuOpen && (
          <nav className="nav-mobile">
            {navItems.map(n => (
              <NavLink key={n.to} to={n.to} end={!!n.end}
                className={({ isActive }) => `nav-link-mobile ${isActive ? 'active' : ''}`}
                onClick={() => setMenuOpen(false)}>
                <span className="nav-icon">{n.icon}</span> {n.label}
              </NavLink>
            ))}
            <div style={{margin:'8px 0', padding:'8px 0', borderTop:'1px solid var(--border)'}}>
              <UnidadeSelector />
            </div>
            <button className="btn btn-danger btn-sm" style={{alignSelf:'flex-start'}} onClick={logout}>
              Sair
            </button>
          </nav>
        )}
      </header>
      <main className="main">{children}</main>
    </div>
  )
}

// ── App com proteção e providers ─────────────────────────────────────────
function ProtectedApp() {
  const { user }            = useAuth()
  const { loadingPerfil }   = useUser()

  if (user === undefined || (user && loadingPerfil)) {
    return (
      <div style={{display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh'}}>
        <div className="loading"><div className="spinner"></div><div>Carregando...</div></div>
      </div>
    )
  }

  if (user === null) return <LoginPage />

  return (
    <Layout>
      <Routes>
        <Route path="/"          element={<DashboardPage />} />
        <Route path="/entrada"   element={<EntradaPage />} />
        <Route path="/nf/:id"    element={<NFDetailPage />} />
        <Route path="/saida"     element={<SaidaPage />} />
        <Route path="/log"       element={<LogPage />} />
        <Route path="/config"    element={<ConfigPage />} />
        <Route path="/usuarios"  element={<UsersPage />} />
        <Route path="*"          element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

function AppWithUser() {
  const { user } = useAuth()
  return (
    <UserProvider firebaseUser={user}>
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
