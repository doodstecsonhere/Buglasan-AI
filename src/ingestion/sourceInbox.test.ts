import { describe, expect, it, vi } from 'vitest'
import { analyzeSourceInbox, approveSourceInboxPreview, deterministicLocalImageProvider, type MediaAnalysisProvider } from './sourceInbox'

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])
const input = (images = [{ name: 'poster.png', mimeType: 'image/png', bytes: png }], operatorCaption: string | null = 'Official schedule') => ({ facebookPostUrl: 'https://www.facebook.com/Buglasan/posts/123', images, operatorCaption, collectedAt: '2026-09-16T00:00:00.000Z' })

describe('local trusted image source inbox', () => {
  it('is strictly non-mutating until explicit approval and preserves separate provenance', async () => {
    const preview = await analyzeSourceInbox(input())
    expect(preview.status).toBe('ready_for_approval')
    expect(preview.image_evidence[0]).toMatchObject({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/), validation: 'accepted' })
    expect(preview.analyses[0]).toMatchObject({ provider: 'deterministic-local', text_state: 'unknown' })
    const dispatch = vi.fn((payload) => payload)
    expect(dispatch).not.toHaveBeenCalled()
    const payload = approveSourceInboxPreview(preview, dispatch)
    expect(dispatch).toHaveBeenCalledOnce()
    expect(payload.source_metadata).toMatchObject({ source_inbox: { operator_caption: 'Official schedule' } })
  })

  it('accepts multiple images and records provider errors as partial failures', async () => {
    const provider: MediaAnalysisProvider = { ...deterministicLocalImageProvider, async analyzeImage(image, _bytes, time) { if (image.name === 'bad.png') throw new Error('offline fixture failure'); return deterministicLocalImageProvider.analyzeImage(image, _bytes, time) } }
    const preview = await analyzeSourceInbox(input([{ name: 'good.png', mimeType: 'image/png', bytes: png }, { name: 'bad.png', mimeType: 'image/png', bytes: png }], null), provider)
    expect(preview.image_evidence).toHaveLength(2)
    expect(preview.analyses.map((analysis) => analysis.failure)).toEqual([null, 'offline fixture failure'])
    expect(preview.source_type).toBe('image')
  })

  it('rejects dangerous or malformed inputs and distinguishes caption-only and reference-only', async () => {
    const malformed = await analyzeSourceInbox(input([{ name: 'evil.png', mimeType: 'image/png', bytes: new Uint8Array([1]) }], null))
    expect(malformed.status).toBe('failed')
    expect(malformed.image_evidence[0].failure).toMatch(/signature mismatch/)
    await expect(analyzeSourceInbox({ ...input(), facebookPostUrl: 'http://facebook.com/x' })).rejects.toThrow(/HTTPS/)
    await expect(analyzeSourceInbox({ ...input(), facebookPostUrl: 'https://www.facebook.com/HarborDays/posts/123' })).rejects.toThrow(/official/)
    expect((await analyzeSourceInbox(input([], 'Caption only'))).source_type).toBe('text')
    const reference = await analyzeSourceInbox(input([], null))
    expect(reference.status).toBe('reference_only')
    expect(() => approveSourceInboxPreview(reference, vi.fn())).toThrow(/Only usable/)
  })

  it('has stable replay identity and does not expose a generic configuration or secret path', async () => {
    const first = await analyzeSourceInbox(input())
    const replay = await analyzeSourceInbox(input())
    expect(first.replay_key).toBe(replay.replay_key)
    expect(JSON.stringify(first)).not.toMatch(/secret|token|apikey/i)
  })
})
