import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { ThemeProvider, useTheme } from './lib/ThemeContext'
import { UserProvider, useUser, UNIDADES_DEFAULT } from './lib/UserContext'
import { OperacaoProvider, useOperacao, OPERACOES } from './lib/OperacaoContext'
import { listarNFsEntrada, statusVencimentoNF } from './lib/faconagem'
import EntradaPage    from './pages/EntradaPage'
import SaidaPage      from './pages/SaidaPage'
import DashboardPage  from './pages/DashboardPage'
import NFDetailPage   from './pages/NFDetailPage'
import LogPage        from './pages/LogPage'
import ConfigPage     from './pages/ConfigPage'
import UsersPage      from './pages/UsersPage'
import LoginPage      from './pages/LoginPage'
import KpisPage       from './pages/KpisPage'
import InventarioPage from './pages/InventarioPage'
import MapaCalorPage   from './pages/MapaCalorPage'
import RelatoriosPage  from './pages/RelatoriosPage'
import CadastroSankhiaPage from './pages/CadastroSankhiaPage'
import './index.css'

// ── PWA Update Banner ────────────────────────────────────────────
function PWAUpdateBanner() {
  const [needsUpdate, setNeedsUpdate] = useState(false)
  const [registration, setRegistration] = useState(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.ready.then(reg => {
      setRegistration(reg)
      // Já tem um SW esperando? (update chegou antes do banner montar)
      if (reg.waiting) { setNeedsUpdate(true); return }
      // Escuta novas instalações
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        if (!newWorker) return
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setNeedsUpdate(true)
          }
        })
      })
    })
    // Escuta mensagem do SW avisando que está pronto
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload()
    })
  }, [])

  const handleUpdate = () => {
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    }
    setNeedsUpdate(false)
  }

  if (!needsUpdate) return null

  return (
    <div style={{
      position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, display: 'flex', alignItems: 'center', gap: 12,
      background: 'var(--accent)', color: '#fff',
      borderRadius: 12, padding: '12px 20px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      fontSize: 13, fontWeight: 600,
      animation: 'slideUp 0.3s ease',
      whiteSpace: 'nowrap',
    }}>
      <span>🚀 Nova versão disponível!</span>
      <button
        onClick={handleUpdate}
        style={{
          background: '#fff', color: 'var(--accent)',
          border: 'none', borderRadius: 8,
          padding: '6px 14px', fontWeight: 700,
          fontSize: 12, cursor: 'pointer',
        }}
      >
        Atualizar agora
      </button>
      <button
        onClick={() => setNeedsUpdate(false)}
        style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16, padding: 0 }}
      >✕</button>
    </div>
  )
}
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

const Icons = {
  Dashboard:  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>,
  Entrada:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22V12"/><path d="m8 18 4 4 4-4"/><path d="M20 12V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4"/><circle cx="12" cy="12" r="2"/></svg>,
  Saida:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 12V2"/><path d="m16 6-4-4-4 4"/><path d="M20 12V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/><circle cx="12" cy="12" r="2"/></svg>,
  KPIs:       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>,
  Inventario: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>,
  Mapa:       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 1 1 4 0Z"/></svg>,
  Relatorios: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>,
  Sankhia:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
  Log:        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  Config:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>,
  Usuarios:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  Factory:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/></svg>
};

const NAV_BASE = [
  { to: '/',            label: 'Dashboard',  icon: Icons.Dashboard,  end: true },
  { to: '/entrada',     label: 'NF Entrada', icon: Icons.Entrada },
  { to: '/saida',       label: 'Saída',      icon: Icons.Saida },
  { to: '/kpis',        label: 'KPIs',       icon: Icons.KPIs },
  { to: '/inventario',  label: 'Inventário', icon: Icons.Inventario },
  { to: '/mapa',        label: 'Mapa',       icon: Icons.Mapa },
  { to: '/relatorios',  label: 'Relatórios', icon: Icons.Relatorios },
  { to: '/sankhia',     label: 'Sankhia',    icon: Icons.Sankhia },
  { to: '/log',         label: 'Histórico',  icon: Icons.Log },
  { to: '/config',      label: 'Config',     icon: Icons.Config },
]

// ── Seletor de Unidade no header ─────────────────────────────────
function UnidadeSelector() {
  const ctx = useUser()
  if (!ctx || !ctx.perfil) return null

  const { isAdmin, isSupervisor, isSupervisorCorradi, unidadeAtiva, trocarUnidade, perfil } = ctx

  if (!isAdmin && !isSupervisor && !isSupervisorCorradi) {
    const un = UNIDADES_DEFAULT.find(u => u.id === perfil.unidade_id)
    if (!un) return null
    return (
      <div className="unidade-badge" title="Sua unidade vinculada">
        {Icons.Factory}
        <span>{un.label}</span>
      </div>
    )
  }

  return (
    <div className="unidade-selector-wrap" title="Unidade ativa">
      {Icons.Factory}
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

// ── Seletor de Operação no header ────────────────────────────────
function OperacaoSelector() {
  const opCtx = useOperacao()
  if (!opCtx) return null

  const { operacaoAtiva, trocarOperacao, operacaoInfo, podeTrocar } = opCtx

  if (!podeTrocar) {
    // Supervisor — mostra badge estático
    return (
      <div className="operacao-badge" style={{ background: operacaoInfo.cor + '22', borderColor: operacaoInfo.cor + '55' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: operacaoInfo.cor, display: 'inline-block' }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: operacaoInfo.cor }}>{operacaoInfo.label}</span>
      </div>
    )
  }

  return (
    <div className="operacao-selector-wrap" title="Operação ativa">
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: operacaoInfo.cor, display: 'inline-block' }} />
      <select
        className="operacao-select"
        value={operacaoAtiva}
        onChange={e => trocarOperacao(e.target.value)}
        style={{ borderColor: operacaoInfo.cor + '55' }}
      >
        {OPERACOES.map(o => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

// ── Layout principal ─────────────────────────────────────────────
function Layout({ children }) {
  const [menuOpen, setMenuOpen]         = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const { theme, toggle }       = useTheme()
  const { user, logout }        = useAuth()
  const ctx                     = useUser()
  const opCtx                   = useOperacao()
  const isAdmin             = ctx?.isAdmin ?? false
  const isSupervisorCorradi = ctx?.isSupervisorCorradi ?? false
  const [nfsAlertaCount, setNfsAlertaCount] = useState(0)

  // Carrega badge de vencimento + dispara notificação push ao abrir
  useEffect(() => {
    if (!ctx?.unidadeAtiva || !opCtx?.colecoes) return
    listarNFsEntrada(ctx.unidadeAtiva, opCtx.colecoes).then(nfs => {
      const alertas = nfs.filter(n => ['vencida','alerta'].includes(statusVencimentoNF(n)))
      setNfsAlertaCount(alertas.length)

      // Notificação push — só se tiver permissão e houver alertas
      if (alertas.length === 0) return
      if (!('Notification' in window)) return

      const disparar = () => {
        const vencidas = alertas.filter(n => statusVencimentoNF(n) === 'vencida').length
        const emAlerta = alertas.filter(n => statusVencimentoNF(n) === 'alerta').length
        const linhas = []
        if (vencidas > 0) linhas.push(`🚨 ${vencidas} NF${vencidas>1?'s':''} vencida${vencidas>1?'s':''}`)
        if (emAlerta > 0) linhas.push(`⚠️ ${emAlerta} NF${emAlerta>1?'s':''} vencem em breve`)
        new Notification('Façonagem Corradi Mazzer — Atenção!', {
          body: linhas.join('\n'),
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: 'nf-vencimento', // evita múltiplas notificações duplicadas
        })
      }

      if (Notification.permission === 'granted') {
        disparar()
      } else if (Notification.permission === 'default') {
        Notification.requestPermission().then(p => { if (p === 'granted') disparar() })
      }
    }).catch(() => {})
  }, [ctx?.unidadeAtiva, opCtx?.operacaoAtiva])

  const navItems = isAdmin
    ? [...NAV_BASE, { to: '/usuarios', label: 'Usuários', icon: Icons.Usuarios }]
    : isSupervisorCorradi
    ? NAV_BASE.filter(n => n.to !== '/config')
    : NAV_BASE

  const badgeFor = (to) => {
    if (to === '/entrada' && nfsAlertaCount > 0) return nfsAlertaCount
    return null
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">

          {/* Brand */}
          <div className="header-brand">
            <img src="/logo.svg" alt="Logo" className="brand-icon" style={{width:34,height:34,borderRadius:7,display:'block'}} />
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
                <NavLink key={n.to} to={n.to} end={!!n.end}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <span className="nav-icon">{n.icon}</span>{n.label}
                  {badge && <span style={{ marginLeft:5, background:'var(--danger)', color:'#fff', borderRadius:99, fontSize:10, fontWeight:700, padding:'1px 6px', lineHeight:'16px' }}>{badge}</span>}
                </NavLink>
              )
            })}
          </nav>

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <div className="header-operacao-selector">
              <OperacaoSelector />
            </div>
            <div className="header-unit-selector">
              <UnidadeSelector />
            </div>
            <button className="btn-theme-icon" onClick={toggle} title="Alternar tema">
              {theme === 'dark' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M22 12h2"/><path d="m4.93 19.07 1.41-1.41"/><path d="m17.66 6.34 1.41-1.41"/></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
              )}
            </button>
            <div style={{ position: 'relative' }}>
              <button
                className="user-chip"
                onClick={() => setUserMenuOpen(o => !o)}
                title="Perfil"
                style={{ cursor: 'pointer', border: 'none', background: 'none', padding: 0 }}
              >
                {user?.photoURL
                  ? <img src={user.photoURL} alt="" style={{ width: 26, height: 26, borderRadius: '50%' }} />
                  : <span style={{ fontSize: 13 }}>{(user?.displayName || user?.email || '?')[0].toUpperCase()}</span>
                }
              </button>
              {userMenuOpen && (
                <>
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 999 }}
                    onClick={() => setUserMenuOpen(false)}
                  />
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 10px)', right: 0,
                    zIndex: 1000, minWidth: 220,
                    background: 'var(--bg-2)', border: '1px solid var(--border)',
                    borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
                    padding: '14px 16px',
                  }}>
                    {/* Avatar + info */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                        {user?.photoURL
                          ? <img src={user.photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{(user?.displayName || user?.email || '?')[0].toUpperCase()}</span>
                        }
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ctx?.perfil?.nome || user?.displayName || '—'}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {user?.email}
                        </div>
                        <div style={{ fontSize: 10, marginTop: 2 }}>
                          <span style={{ background: 'rgba(34,85,184,0.2)', color: 'var(--accent)', borderRadius: 6, padding: '1px 7px', fontWeight: 600 }}>
                            {ctx?.perfil?.role === 'admin' ? 'Admin' : ctx?.isSupervisorCorradi ? 'Sup. Corradi' : ctx?.isSupervisor ? 'Supervisor' : 'Analista'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div style={{ borderTop: '1px solid var(--border)', marginBottom: 10 }} />
                    <button
                      className="btn btn-danger btn-sm"
                      style={{ width: '100%', justifyContent: 'center' }}
                      onClick={() => { setUserMenuOpen(false); logout() }}
                    >
                      Sair da conta
                    </button>
                  </div>
                </>
              )}
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
            <div style={{ margin: '8px 0', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
              <OperacaoSelector />
            </div>
            <div style={{ margin: '4px 0', padding: '4px 0', borderTop: '1px solid var(--border)' }}>
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

// ── Tela de acesso pendente ───────────────────────────────────────
function PendentePage() {
  const { logout } = useAuth()
  const { perfil } = useUser() || {}
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'var(--bg)' }}>
      <div style={{ maxWidth:420, width:'100%', padding:'40px 32px', background:'var(--bg-2)', borderRadius:16, border:'1px solid var(--border)', textAlign:'center' }}>
        <img src="/logo.svg" alt="Logo" style={{ width:72, height:72, borderRadius:12, marginBottom:20 }} />
        <div style={{ fontSize:20, fontWeight:700, color:'var(--text)', marginBottom:8 }}>Acesso Pendente</div>
        <div style={{ fontSize:14, color:'var(--text-dim)', marginBottom:24, lineHeight:1.6 }}>
          Olá, <strong style={{color:'var(--text)'}}>{perfil?.nome || perfil?.email}</strong>!<br/>
          Seu cadastro foi realizado com sucesso. Aguarde um administrador liberar seu acesso ao sistema.
        </div>
        <div style={{ padding:'12px 16px', background:'rgba(255,180,0,0.08)', border:'1px solid var(--warn)', borderRadius:8, fontSize:13, color:'var(--warn)', marginBottom:24 }}>
          ⏳ Assim que seu perfil for aprovado, você poderá entrar normalmente.
        </div>
        <button className="btn btn-ghost" onClick={logout}>Sair da conta</button>
      </div>
    </div>
  )
}

// ── Protected routes ─────────────────────────────────────────────
function ProtectedApp() {
  const { user }            = useAuth()
  const ctx                 = useUser()
  const loadingPerfil       = ctx?.loadingPerfil ?? true
  const perfil              = ctx?.perfil
  const isSupervisor        = ctx?.isSupervisor ?? false
  const isSupervisorCorradi = ctx?.isSupervisorCorradi ?? false

  // Auth loading
  if (user === undefined || (user !== null && loadingPerfil)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="loading"><div className="spinner" /><div>Carregando...</div></div>
      </div>
    )
  }

  if (user === null) return <LoginPage />

  // Usuário pendente — aguarda aprovação do admin
  if (perfil?.role === 'pendente') return <PendentePage />

  return (
    <>
      <Layout>
        <Routes>
          <Route path="/"         element={<DashboardPage />} />
          <Route path="/entrada"  element={<EntradaPage />} />
          <Route path="/nf/:id"   element={<NFDetailPage />} />
          <Route path="/saida"    element={<SaidaPage />} />
          <Route path="/kpis"       element={<KpisPage />} />
          <Route path="/inventario" element={<InventarioPage />} />
          <Route path="/mapa"       element={<MapaCalorPage />} />
          <Route path="/relatorios" element={<RelatoriosPage />} />
          <Route path="/sankhia"    element={<CadastroSankhiaPage />} />
          <Route path="/log"      element={<LogPage />} />
          <Route path="/config"   element={isSupervisorCorradi ? <Navigate to="/" replace /> : <ConfigPage />} />
          <Route path="/usuarios" element={isSupervisor || isSupervisorCorradi ? <Navigate to="/" replace /> : <UsersPage />} />
          <Route path="*"         element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      <PWAInstallBanner />
      <PWAUpdateBanner />
    </>
  )
}

// Wrapper que injeta o firebaseUser no UserProvider
function AppWithUser() {
  const { user } = useAuth()
  return (
    <UserProvider firebaseUser={user ?? null}>
      <OperacaoProvider>
        <ProtectedApp />
      </OperacaoProvider>
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
