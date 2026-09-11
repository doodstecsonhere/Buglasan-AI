const CACHE_NAME = 'buglasan-ai-shell-v4-branding'
const APP_SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon.png',
]
const APP_SHELL_PATHS = new Set(APP_SHELL)

function isSameOrigin(url) {
  return url.origin === self.location.origin
}

// Vite emits content-hashed JavaScript and CSS into /assets/. These are safe to
// retain until the next worker activation; API and chat traffic never matches.
function isImmutableAppAsset(url) {
  return url.pathname.startsWith('/assets/') && /\.(?:js|css)$/.test(url.pathname)
}

function isCacheableShellUrl(url) {
  return isSameOrigin(url) && (APP_SHELL_PATHS.has(url.pathname) || isImmutableAppAsset(url))
}

async function cacheResponse(cache, request, response) {
  if (response && response.ok) await cache.put(request, response.clone())
  return response
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))))
  self.clients.claim()
})

self.addEventListener('message', event => {
  if (event.data?.type !== 'PRECACHE_APP_SHELL' || !Array.isArray(event.data.urls)) return

  const urls = [...new Set(event.data.urls)]
    .map(value => {
      try {
        return new URL(value, self.location.origin)
      } catch {
        return null
      }
    })
    .filter(url => url && isCacheableShellUrl(url))

  event.waitUntil(caches.open(CACHE_NAME).then(async cache => {
    await Promise.all(urls.map(async url => {
      try {
        await cacheResponse(cache, url.href, await fetch(url.href))
      } catch {
        // A failed optional asset must not prevent the installed shell working.
      }
    }))
  }))
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (!isSameOrigin(url)) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME)
      try {
        // Keep the app entry document current while online; it contains no chat data.
        return await cacheResponse(cache, '/index.html', await fetch(request))
      } catch {
        return (await cache.match('/index.html')) || (await cache.match('/offline.html'))
      }
    })())
    return
  }

  if (!isCacheableShellUrl(url)) return

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(request)
    if (cached) return cached
    try {
      return await cacheResponse(cache, request, await fetch(request))
    } catch {
      return cached || Response.error()
    }
  })())
})
