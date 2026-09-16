import { afterEach, describe, expect, it } from 'vitest'
import { deterministicLocalImageProvider } from '../src/ingestion/sourceInbox.ts'
import { startSourceInboxWebServer, type SourceInboxWebServer } from './source-inbox-web.ts'

const pngBase64 = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]).toString('base64')
let server: SourceInboxWebServer | null = null

afterEach(async () => { await server?.close(); server = null })

describe('local Source Inbox web server', () => {
  it('binds only IPv4 loopback and exposes a non-PWA, no-store local page', async () => {
    server = await startSourceInboxWebServer({ provider: deterministicLocalImageProvider })
    expect(server.host).toBe('127.0.0.1')
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    const response = await fetch(server.url)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    await expect(response.text()).resolves.toContain('Local Source Inbox')
  })

  it('analyzes supplied local bytes without dispatch and rejects malformed web input', async () => {
    server = await startSourceInboxWebServer({ provider: deterministicLocalImageProvider })
    const endpoint = `${server.url}api/analyze`
    const valid = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ facebookPostUrl: 'https://www.facebook.com/Buglasan/posts/123', operatorCaption: 'Local caption', festivalYear: 2026, images: [{ name: 'poster.png', mimeType: 'image/png', base64: pngBase64 }] }) })
    expect(valid.status).toBe(200)
    await expect(valid.json()).resolves.toMatchObject({ preview: { status: 'ready_for_approval', source_type: 'mixed', operator_caption: 'Local caption' } })
    const invalid = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ facebookPostUrl: 'https://www.facebook.com/Buglasan/posts/123', images: [{ name: 'bad.png', mimeType: 'image/png', base64: 'not valid base64!' }] }) })
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toMatchObject({ error: expect.stringMatching(/base64/) })
  })
})
