import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

import { registerSW } from 'virtual:pwa-register'

// Registro automático do Service Worker pelo Vite PWA
registerSW({ immediate: true })

// Garantia extra de registro manual se necessário
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => console.log('SW registrado:', reg))
      .catch(err => console.error('Erro ao registrar SW:', err))
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
