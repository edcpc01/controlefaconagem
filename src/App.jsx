import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { ThemeProvider, useTheme } from './lib/ThemeContext'
import { UserProvider, useUser, UNIDADES_DEFAULT, OPERACOES } from './lib/UserContext'
import { listarNFsEntrada, statusVencimentoNF } from './lib/faconagem'
import EntradaPage       from './pages/EntradaPage'
import SaidaPage         from './pages/SaidaPage'
import DashboardPage     from './pages/DashboardPage'
import NFDetailPage      from './pages/NFDetailPage'
import LogPage           from './pages/LogPage'
import ConfigPage        from './pages/ConfigPage'
import UsersPage         from './pages/UsersPage'
import LoginPage         from './pages/LoginPage'
import KpisPage          from './pages/KpisPage'
import InventarioPage    from './pages/InventarioPage'
import MapaCalorPage     from './pages/MapaCalorPage'
import RelatoriosPage    from './pages/RelatoriosPage'
import './index.css'

// ── PWA Update Banner ────────────────────────────────────────────
function PWAUpdateBanner() {
  const [needsUpdate, setNeedsUpdate] = useState(false)
  const [registration, setRegistration] = useState(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.ready.then(reg => {
      setRegistration(reg)
      if (reg.waiting) { setNeedsUpdate(true); return }
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing
        if (!nw) return
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) setNeedsUpdate(true)
        })
      })
    })
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload())
  }, [])

  const handleUpdate = () => {
    if (registration?.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    setNeedsUpdate(false)
  }

  if (!needsUpdate) return null
  return (
    <div style={{ position:'fixed', bottom:80, left:'50%', transform:'translateX(-50%)', zIndex:9999, display:'flex', alignItems:'center', gap:12, background:'var(--accent)', color:'#fff', borderRadius:12, padding:'12px 20px', boxShadow:'0 4px 24px rgba(0,0,0,0.3)', fontSize:13, fontWeight:600, whiteSpace:'nowrap', animation:'slideUp 0.3s ease' }}>
      <span>🚀 Nova versão disponível!</span>
      <button onClick={handleUpdate} style={{ background:'#fff', color:'var(--accent)', border:'none', borderRadius:8, padding:'6px 14px', fontWeight:700, fontSize:12, cursor:'pointer' }}>Atualizar agora</button>
      <button onClick={() => setNeedsUpdate(false)} style={{ background:'none', border:'none', color:'#fff', cursor:'pointer', fontSize:16, padding:0 }}>✕</button>
    </div>
  )
}

// ── PWA Install Banner ───────────────────────────────────────────
function PWAInstallBanner() {
  const [prompt, setPrompt] = useState(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const handler = e => { e.preventDefault(); setPrompt(e); setVisible(true) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])
  if (!visible || !prompt) return null
  return (
    <div className="pwa-install-banner">
      <span style={{fontSize:28}}>📱</span>
      <div className="pwa-text"><strong>Instalar App</strong><span>Adicione à tela inicial para acesso rápido</span></div>
      <button className="btn btn-primary btn-sm" onClick={async () => { prompt.prompt(); await prompt.userChoice; setVisible(false) }}>Instalar</button>
      <button className="btn btn-ghost btn-sm" onClick={() => setVisible(false)}>✕</button>
    </div>
  )
}

// ── Seletor de Operação no header ────────────────────────────────
function OperacaoSelector() {
  const ctx = useUser()
  if (!ctx || !ctx.perfil) return null
  const { operacaoAtiva, operacaoObj, operacoesPermitidas, selecionarOperacao } = ctx
  const [open, setOpen] = useState(false)

  if (operacoesPermitidas.length <= 1 && operacaoAtiva) {
    // Só uma operação disponível — mostra badge fixo
    return operacaoObj ? (
      <div style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 12px', background:'rgba(255,255,255,0.06)', borderRadius:99, fontSize:12, fontWeight:600 }}>
        <span>{operacaoObj.icon}</span>
        <span style={{ color: operacaoObj.cor }}>{operacaoObj.label}</span>
      </div>
    ) : null
  }

  return (
    <div style={{ position:'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', background:'rgba(255,255,255,0.06)', border:'1px solid var(--border)', borderRadius:99, cursor:'pointer', fontSize:12, fontWeight:600, color:'var(--text)' }}
      >
        {operacaoObj ? (
          <><span>{operacaoObj.icon}</span><span style={{ color: operacaoObj.cor }}>{operacaoObj.label}</span></>
        ) : (
          <span style={{ color:'var(--text-dim)' }}>Selecionar operação</span>
        )}
        <span style={{ color:'var(--text-dim)', fontSize:10 }}>▼</span>
      </button>
      {open && (
        <div style={{ position:'absolute', top:'calc(100% + 8px)', right:0, background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, boxShadow:'0 8px 32px rgba(0,0,0,0.3)', zIndex:200, minWidth:170, overflow:'hidden' }}
          onMouseLeave={() => setOpen(false)}>
          {operacoesPermitidas.map(op => (
            <button key={op.id} onClick={() => { selecionarOperacao(op.id); setOpen(false) }}
              style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'12px 16px', background: operacaoAtiva===op.id ? 'rgba(255,255,255,0.06)' : 'none', border:'none', cursor:'pointer', fontSize:13, fontWeight:600, color:'var(--text)' }}>
              <span>{op.icon}</span>
              <span style={{ color: op.cor }}>{op.label}</span>
              {operacaoAtiva===op.id && <span style={{ marginLeft:'auto', color:'var(--accent)', fontSize:11 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Seletor de Unidade ────────────────────────────────────────────
function UnidadeSelector() {
  const ctx = useUser()
  if (!ctx || !ctx.perfil) return null
  const { isAdmin, isSupervisor, isAnalista, unidadeAtiva, trocarUnidade, perfil } = ctx
  if (isAnalista) {
    const un = UNIDADES_DEFAULT.find(u => u.id === perfil.unidade_id)
    if (!un) return null
    return <div className="unidade-badge" title="Sua unidade vinculada"><span>🏭</span><span>{un.label}</span></div>
  }
  return (
    <div className="unidade-selector-wrap" title="Unidade ativa">
      <span>🏭</span>
      <select className="unidade-select" value={unidadeAtiva} onChange={e => trocarUnidade(e.target.value)}>
        <option value="">Todas as unidades</option>
        {UNIDADES_DEFAULT.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
      </select>
    </div>
  )
}

// ── Nav items ─────────────────────────────────────────────────────
const NAV_BASE = [
  { to: '/',           label: 'Dashboard',  icon: '◈', end: true },
  { to: '/entrada',    label: 'NF Entrada', icon: '↓' },
  { to: '/saida',      label: 'Saída',      icon: '↑' },
  { to: '/kpis',       label: 'KPIs',       icon: '📊' },
  { to: '/inventario', label: 'Inventário', icon: '🔍' },
  { to: '/mapa',       label: 'Mapa',       icon: '🌡️' },
  { to: '/relatorios', label: 'Relatórios', icon: '📑' },
  { to: '/log',        label: 'Histórico',  icon: '📋' },
  { to: '/config',     label: 'Config',     icon: '⚙' },
]
const NAV_SUPERVISOR = [
  { to: '/',           label: 'Dashboard',  icon: '◈', end: true },
  { to: '/entrada',    label: 'NF Entrada', icon: '↓' },
  { to: '/saida',      label: 'Saída',      icon: '↑' },
  { to: '/kpis',       label: 'KPIs',       icon: '📊' },
  { to: '/inventario', label: 'Inventário', icon: '🔍' },
  { to: '/mapa',       label: 'Mapa',       icon: '🌡️' },
  { to: '/relatorios', label: 'Relatórios', icon: '📑' },
  { to: '/log',        label: 'Histórico',  icon: '📋' },
  { to: '/config',     label: 'Config',     icon: '⚙' },
]

// ── Layout principal ─────────────────────────────────────────────
function Layout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { theme, toggle }       = useTheme()
  const { user, logout }        = useAuth()
  const ctx                     = useUser()
  const isAdmin                 = ctx?.isAdmin ?? false
  const isSupervisor            = ctx?.isSupervisor ?? false
  const [nfsAlertaCount, setNfsAlertaCount] = useState(0)

  // Badge vencimento + push notification
  useEffect(() => {
    if (!ctx?.unidadeAtiva) return
    listarNFsEntrada(ctx.unidadeAtiva).then(nfs => {
      const alertas = nfs.filter(n => ['vencida','alerta'].includes(statusVencimentoNF(n)))
      setNfsAlertaCount(alertas.length)
      if (alertas.length === 0 || !('Notification' in window)) return
      const disparar = () => {
        const vencidas = alertas.filter(n => statusVencimentoNF(n) === 'vencida').length
        const emAlerta = alertas.filter(n => statusVencimentoNF(n) === 'alerta').length
        const linhas = []
        if (vencidas > 0) linhas.push(`🚨 ${vencidas} NF${vencidas>1?'s':''} vencida${vencidas>1?'s':''}`)
        if (emAlerta > 0) linhas.push(`⚠️ ${emAlerta} NF${emAlerta>1?'s':''} vencem em breve`)
        new Notification('Controle de Façonagem — Atenção!', { body: linhas.join('\n'), icon: '/icon-192.png', badge: '/icon-192.png', tag: 'nf-vencimento' })
      }
      if (Notification.permission === 'granted') disparar()
      else if (Notification.permission === 'default') Notification.requestPermission().then(p => { if (p === 'granted') disparar() })
    }).catch(() => {})
  }, [ctx?.unidadeAtiva])

  const navItems = isAdmin
    ? [...NAV_BASE, { to: '/usuarios', label: 'Usuários', icon: '👥' }]
    : isSupervisor ? NAV_SUPERVISOR : NAV_BASE

  const badgeFor = to => (to === '/entrada' && nfsAlertaCount > 0) ? nfsAlertaCount : null

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          {/* Brand */}
          <div className="header-brand">
            <span className="brand-icon">⬡</span>
            <div>
              <div className="brand-title">Façonagem</div>
              <div className="brand-sub">Corradi Mazzer</div>
            </div>
          </div>

          {/* Nav desktop */}
          <nav className="nav-desktop">
            {navItems.map(n => {
              const badge = badgeFor(n.to)
              return (
                <NavLink key={n.to} to={n.to} end={!!n.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <span className="nav-icon">{n.icon}</span>{n.label}
                  {badge && <span style={{ marginLeft:5, background:'var(--danger)', color:'#fff', borderRadius:99, fontSize:10, fontWeight:700, padding:'1px 6px', lineHeight:'16px' }}>{badge}</span>}
                </NavLink>
              )
            })}
          </nav>

          {/* Actions */}
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div className="header-unit-selector"><UnidadeSelector /></div>
            <OperacaoSelector />
            <button className="btn-theme-icon" onClick={toggle} title="Alternar tema">{theme === 'dark' ? '☀' : '🌙'}</button>
            <div className="user-chip" title={`${ctx?.perfil?.role || 'analista'} — ${user?.email}`}>
              {user?.photoURL
                ? <img src={user.photoURL} alt="" style={{ width:26, height:26, borderRadius:'50%' }} />
                : <span style={{ fontSize:13 }}>{(user?.displayName || user?.email || '?')[0].toUpperCase()}</span>}
            </div>
            <button className="hamburger" onClick={() => setMenuOpen(o => !o)}>☰</button>
          </div>
        </div>

        {/* Nav mobile */}
        {menuOpen && (
          <nav className="nav-mobile">
            {navItems.map(n => {
              const badge = badgeFor(n.to)
              return (
                <NavLink key={n.to} to={n.to} end={!!n.end}
                  className={({ isActive }) => `nav-link-mobile ${isActive ? 'active' : ''}`}
                  onClick={() => setMenuOpen(false)}>
                  <span className="nav-icon">{n.icon}</span> {n.label}
                  {badge && <span style={{ marginLeft:6, background:'var(--danger)', color:'#fff', borderRadius:99, fontSize:10, fontWeight:700, padding:'1px 6px' }}>{badge}</span>}
                </NavLink>
              )
            })}
            <div style={{ margin:'8px 0', padding:'8px 0', borderTop:'1px solid var(--border)' }}>
              <UnidadeSelector />
            </div>
            {/* Seleção de operação no menu mobile */}
            <div style={{ padding:'8px 0', borderTop:'1px solid var(--border)' }}>
              <div style={{ fontSize:11, color:'var(--text-dim)', marginBottom:8, paddingLeft:4 }}>OPERAÇÃO</div>
              {(ctx?.operacoesPermitidas || OPERACOES).map(op => (
                <button key={op.id}
                  onClick={() => { ctx?.selecionarOperacao(op.id); setMenuOpen(false) }}
                  style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'10px 4px', background: ctx?.operacaoAtiva===op.id ? 'rgba(255,255,255,0.06)' : 'none', border:'none', cursor:'pointer', fontSize:13, fontWeight:600, color:'var(--text)', borderRadius:8 }}>
                  <span>{op.icon}</span>
                  <span style={{ color: op.cor }}>{op.label}</span>
                  {ctx?.operacaoAtiva===op.id && <span style={{ marginLeft:'auto', color:'var(--accent)' }}>✓</span>}
                </button>
              ))}
            </div>
            <button className="btn btn-danger btn-sm" style={{ alignSelf:'flex-start', marginTop:4 }} onClick={logout}>Sair</button>
          </nav>
        )}
      </header>

      <main className="main"><div className="container">{children}</div></main>
    </div>
  )
}

// ── Protected routes ─────────────────────────────────────────────
function ProtectedApp() {
  const { user }      = useAuth()
  const ctx           = useUser()
  const loadingPerfil = ctx?.loadingPerfil ?? true
  const isSupervisor  = ctx?.isSupervisor  ?? false

  if (user === undefined || (user !== null && loadingPerfil)) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh' }}>
        <div className="loading"><div className="spinner" /><div>Carregando...</div></div>
      </div>
    )
  }

  if (user === null) return <LoginPage />

  return (
    <>
      <Layout>
        <Routes>
          <Route path="/"           element={<DashboardPage />} />
          <Route path="/entrada"    element={<EntradaPage />} />
          <Route path="/nf/:id"     element={<NFDetailPage />} />
          <Route path="/saida"      element={isSupervisor ? <SaidaPage /> : <SaidaPage />} />
          <Route path="/kpis"       element={<KpisPage />} />
          <Route path="/inventario" element={<InventarioPage />} />
          <Route path="/mapa"       element={<MapaCalorPage />} />
          <Route path="/relatorios" element={<RelatoriosPage />} />
          <Route path="/log"        element={<LogPage />} />
          <Route path="/config"     element={<ConfigPage />} />
          <Route path="/usuarios"   element={isSupervisor ? <Navigate to="/" replace /> : <UsersPage />} />
          <Route path="*"           element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      <PWAInstallBanner />
      <PWAUpdateBanner />
    </>
  )
}

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
