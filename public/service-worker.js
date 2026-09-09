const CACHE_NAME = 'buglasan-ai-shell-v1'
const APP_SHELL = ['/', '/index.html', '/offline.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.svg', '/icons/icon-512.svg', '/icons/icon-512-maskable.svg']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))))
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')))
    return
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)))
})
