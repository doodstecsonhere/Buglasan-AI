import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workerSource = readFileSync(resolve(process.cwd(), 'public/service-worker.js'), 'utf8')

describe('production service worker shell policy', () => {
  it('caches only the shell and Vite immutable JavaScript/CSS assets', () => {
    expect(workerSource).toContain("url.pathname.startsWith('/assets/')")
    expect(workerSource).toContain('/\\.(?:js|css)$/')
    expect(workerSource).toContain("APP_SHELL_PATHS.has(url.pathname)")
  })

  it('uses the cached application entry for offline navigations and retains offline.html', () => {
    expect(workerSource).toContain("cache.match('/index.html')")
    expect(workerSource).toContain("cache.match('/offline.html')")
  })

  it('does not intercept non-GET or non-shell requests, including chat APIs', () => {
    expect(workerSource).toContain("if (request.method !== 'GET') return")
    expect(workerSource).toContain("if (!isCacheableShellUrl(url)) return")
    expect(workerSource).not.toContain('/functions/v1/chat')
    expect(workerSource).not.toContain('api')
  })
})
