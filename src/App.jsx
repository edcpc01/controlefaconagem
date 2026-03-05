import { useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { ThemeProvider, useTheme } from './lib/ThemeContext'
import EntradaPage   from './pages/EntradaPage'
import SaidaPage     from './pages/SaidaPage'
import DashboardPage from './pages/DashboardPage'
import NFDetailPage  from './pages/NFDetailPage'
import LogPage       from './pages/LogPage'
import ConfigPage    from './pages/ConfigPage'
import LoginPage     from './pages/LoginPage'
import './index.css'

function NavItems({ onClick }) {
  const items = [
    { to: '/',        label: 'Dashboard', icon: '◈', end: true },
    { to: '/entrada', label: 'NF Entrada', icon: '↓' },
    { to: '/saida',   label: 'Saída',      icon: '↑' },
    { to: '/log',     label: 'Histórico',  icon: '📋' },
    { to: '/config',  label: 'Config',     icon: '⚙' },
  ]
  return items.map(n => (
    <NavLink key={n.to} to={n.to} end={!!n.end}
      className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
      onClick={onClick}>
      <span className="nav-icon">{n.icon}</span>{label_only(n.label)}
    </NavLink>
  ))
}

function label_only(l) { return l }

function Layout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { theme, toggle }       = useTheme()
  const { user, logout }        = useAuth()

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <span className="brand-icon">⬡</span>
            <div>
              <div className="brand-title">Façonagem</div>
              <div className="brand-sub">Rhodia Santo André</div>
            </div>
          </div>

          <nav className="nav-desktop">
            {[
              { to: '/',        label: 'Dashboard', icon: '◈', end: true },
              { to: '/entrada', label: 'NF Entrada', icon: '↓' },
              { to: '/saida',   label: 'Saída',      icon: '↑' },
              { to: '/log',     label: 'Histórico',  icon: '📋' },
              { to: '/config',  label: 'Config',     icon: '⚙' },
            ].map(n => (
              <NavLink key={n.to} to={n.to} end={!!n.end}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">{n.icon}</span>{n.label}
              </NavLink>
            ))}
          </nav>

          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <button className="btn-theme-icon" onClick={toggle} title="Alternar tema">
              {theme === 'dark' ? '☀' : '🌙'}
            </button>
            <div className="user-chip" title={user?.email}>
              {user?.photoURL
                ? <img src={user.photoURL} alt="" style={{width:26,height:26,borderRadius:'50%'}} />
                : <span style={{fontSize:13}}>{(user?.displayName || user?.email || '?')[0].toUpperCase()}</span>
              }
            </div>
            <button className="hamburger" onClick={() => setMenuOpen(o => !o)}>☰</button>
          </div>
        </div>

        {menuOpen && (
          <nav className="nav-mobile">
            {[
              { to: '/',        label: 'Dashboard', icon: '◈', end: true },
              { to: '/entrada', label: 'NF Entrada', icon: '↓' },
              { to: '/saida',   label: 'Saída',      icon: '↑' },
              { to: '/log',     label: 'Histórico',  icon: '📋' },
              { to: '/config',  label: 'Config',     icon: '⚙' },
            ].map(n => (
              <NavLink key={n.to} to={n.to} end={!!n.end}
                className={({ isActive }) => `nav-link-mobile ${isActive ? 'active' : ''}`}
                onClick={() => setMenuOpen(false)}>
                <span className="nav-icon">{n.icon}</span> {n.label}
              </NavLink>
            ))}
            <button className="btn btn-danger btn-sm" style={{marginTop:8, alignSelf:'flex-start'}} onClick={logout}>
              Sair
            </button>
          </nav>
        )}
      </header>
      <main className="main">{children}</main>
    </div>
  )
}

function ProtectedApp() {
  const { user } = useAuth()

  // Ainda verificando auth
  if (user === undefined) {
    return (
      <div style={{display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh'}}>
        <div className="loading"><div className="spinner"></div><div>Carregando...</div></div>
      </div>
    )
  }

  // Não autenticado
  if (user === null) return <LoginPage />

  // Autenticado
  return (
    <Layout>
      <Routes>
        <Route path="/"          element={<DashboardPage />} />
        <Route path="/entrada"   element={<EntradaPage />} />
        <Route path="/nf/:id"    element={<NFDetailPage />} />
        <Route path="/saida"     element={<SaidaPage />} />
        <Route path="/log"       element={<LogPage />} />
        <Route path="/config"    element={<ConfigPage />} />
        <Route path="*"          element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <ProtectedApp />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}
