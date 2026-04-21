// Service Worker customizado — Façonagem Corradi Mazzer
// Responde ao comando SKIP_WAITING enviado pelo banner de atualização

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
