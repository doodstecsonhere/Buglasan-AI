import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        const urls = performance.getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((url) => {
            const pathname = new URL(url, window.location.origin).pathname
            return pathname.startsWith('/assets/') && /\.(?:js|css)$/.test(pathname)
          })

        registration.active?.postMessage({ type: 'PRECACHE_APP_SHELL', urls })
      })
      .catch((error: unknown) => {
        console.warn('Service worker registration failed:', error)
      })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
