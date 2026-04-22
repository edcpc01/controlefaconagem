import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

import { registerSW } from 'virtual:pwa-register'

// Apenas o Vite PWA (evita dois registros de /sw.js — cache antigo e ReferenceError “fantasma”)
registerSW({ immediate: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
