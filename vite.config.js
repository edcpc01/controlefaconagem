import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Versão automática baseada no timestamp de build
const BUILD_VERSION = Date.now().toString()

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'icon-144-new.png', 'icon-192-new.png', 'icon-256-new.png', 'icon-512-new.png', 'logo.svg'],
      manifest: {
        name: 'Façonagem Corradi Mazzer - Controle de Entradas e Saídas',
        short_name: 'Façonagem',
        description: 'Sistema de controle de façonagem - entradas e saídas',
        theme_color: '#1a4da1',
        background_color: '#1a4da1',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'icon-144-new.png', sizes: '144x144', type: 'image/png', purpose: 'any' },
          { src: 'icon-192-new.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-256-new.png', sizes: '256x256', type: 'image/png', purpose: 'any' },
          { src: 'icon-512-new.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512-new.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        cacheId: `faconagem-v${BUILD_VERSION}`,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: true,
        additionalManifestEntries: [],
        importScripts: ['/sw-custom.js'],
        runtimeCaching: [
          {
            // Firebase Firestore
            urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'firebase-firestore', networkTimeoutSeconds: 8 }
          },
          {
            // Firebase Auth
            urlPattern: /^https:\/\/.*\.firebaseapp\.com\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'firebase-auth', networkTimeoutSeconds: 8 }
          },
          {
            // CDN pdfjs worker
            urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'cdn-assets', expiration: { maxAgeSeconds: 86400 * 30 } }
          }
        ]
      }
    })
  ]
})

