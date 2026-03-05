import { useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import EntradaPage from './pages/EntradaPage'
import SaidaPage from './pages/SaidaPage'
import DashboardPage from './pages/DashboardPage'
import './index.css'

function Layout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false)

  const navItems = [
    { to: '/', label: 'Dashboard', icon: '◈' },
    { to: '/entrada', label: 'NF Entrada', icon: '↓' },
    { to: '/saida', label: 'Saída', icon: '↑' },
  ]

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
            {navItems.map(n => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">{n.icon}</span>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <button className="hamburger" onClick={() => setMenuOpen(o => !o)}>☰</button>
        </div>
        {menuOpen && (
          <nav className="nav-mobile">
            {navItems.map(n => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-link-mobile ${isActive ? 'active' : ''}`} onClick={() => setMenuOpen(false)}>
                <span className="nav-icon">{n.icon}</span> {n.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="main">{children}</main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/entrada" element={<EntradaPage />} />
          <Route path="/saida" element={<SaidaPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
