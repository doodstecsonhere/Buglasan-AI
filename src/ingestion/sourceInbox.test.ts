import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createWorker } from 'tesseract.js'
import localEnglishData from '@tesseract.js-data/eng'
import { analyzeSourceInbox, approveSourceInboxPreview, createOfflineTesseractImageProvider, deterministicLocalImageProvider, type MediaAnalysisProvider } from './sourceInbox'

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
    const preview = await analyzeSourceInbox(input([{ name: 'good.png', mimeType: 'image/png', bytes: png }, { name: 'bad.png', mimeType: 'image/png', bytes: new Uint8Array([...png, 1]) }], null), provider)
    expect(preview.image_evidence).toHaveLength(2)
    expect(preview.analyses.map((analysis) => analysis.failure)).toEqual([null, 'offline fixture failure'])
    expect(preview.source_type).toBe('image')
  })

  it('runs bounded local OCR through an injected offline Tesseract-compatible recognizer without mutating the collector', async () => {
    const recognize = vi.fn(async (_bytes: Uint8Array) => ({ data: { text: '  Hibalag\nSchedule  ', confidence: 87.5 } }))
    const preview = await analyzeSourceInbox(input(), createOfflineTesseractImageProvider({ recognize }))
    expect(recognize).toHaveBeenCalledOnce()
    expect(preview.analyses[0]).toMatchObject({ provider: 'tesseract.js-local', provider_version: '6-compatible', method: 'ocr', confidence: 87.5, granularity: 'document', text_state: 'text', ocr_text: 'Hibalag Schedule', review_state: 'needs_review', warnings: ['OCR is machine-generated and must be checked against the source image.'] })
    expect(preview.image_evidence[0]).toMatchObject({ duplicate_of: null, validation: 'accepted' })
    expect(preview.requires_ocr_review).toBe(true)
    expect(() => approveSourceInboxPreview(preview, vi.fn())).toThrow(/explicit operator confirmation/)
    expect(() => approveSourceInboxPreview(preview, vi.fn(), { confirmOcrReview: true })).not.toThrow()
  })

  it('deduplicates byte-identical images before OCR and retains bounded validation failures', async () => {
    const provider = { ...deterministicLocalImageProvider, analyzeImage: vi.fn(deterministicLocalImageProvider.analyzeImage) }
    const preview = await analyzeSourceInbox(input([{ name: 'one.png', mimeType: 'image/png', bytes: png }, { name: 'two.png', mimeType: 'image/png', bytes: png }], null), provider)
    expect(preview.image_evidence.map((image) => image.validation)).toEqual(['accepted', 'rejected'])
    expect(preview.image_evidence[1]).toMatchObject({ duplicate_of: preview.image_evidence[0].sha256, failure: 'duplicate image bytes' })
    expect(provider.analyzeImage).toHaveBeenCalledOnce()
    await expect(analyzeSourceInbox({ ...input(), collectedAt: 'not-a-date' })).rejects.toThrow(/ISO-8601/)
    await expect(analyzeSourceInbox({ ...input(), operatorCaption: 'a'.repeat(12_001) })).rejects.toThrow(/12000/)
  })

  it('accepts signed local video only through an injected provider and requires review of generated material', async () => {
    const mp4 = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0])
    const provider: MediaAnalysisProvider = {
      ...deterministicLocalImageProvider,
      async analyzeVideo(video, _bytes, analyzedAt) {
        return { video_sha256: video.sha256, provider: 'local-fixture', provider_version: '1', method: 'ffprobe+ffmpeg+tesseract+whisper.cpp', analyzed_at: analyzedAt, review_state: 'needs_review', transcript_state: 'text', transcript: 'Hibalag schedule', duration_seconds: 3, frame_count: 1, frame_analyses: [], derived_evidence: '[SPEECH 00:00:00.000-00:00:03.000] Hibalag schedule', observations: ['Fixture only'], warnings: ['Review required'], failure: null }
      },
    }
    const preview = await analyzeSourceInbox({ ...input([], null), videos: [{ name: 'schedule.mp4', mimeType: 'video/mp4', bytes: mp4 }] }, provider)
    expect(preview).toMatchObject({ source_type: 'video', status: 'ready_for_approval', requires_ocr_review: true, video_evidence: [{ validation: 'accepted' }], video_analyses: [{ transcript: 'Hibalag schedule', frame_count: 1 }] })
    expect(() => approveSourceInboxPreview(preview, vi.fn())).toThrow(/explicit operator confirmation/)
  })

  it('rejects malformed videos and does not treat an unavailable video provider as usable content', async () => {
    const malformed = await analyzeSourceInbox({ ...input([], null), videos: [{ name: 'bad.mp4', mimeType: 'video/mp4', bytes: new Uint8Array([1, 2]) }] })
    expect(malformed).toMatchObject({ status: 'failed', video_evidence: [{ validation: 'rejected', failure: expect.stringMatching(/signature/) }] })
    const quicktime = await analyzeSourceInbox({ ...input([], null), videos: [{ name: 'legacy.mov', mimeType: 'video/quicktime', bytes: new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]) }] })
    expect(quicktime).toMatchObject({ status: 'failed', video_evidence: [{ validation: 'rejected', failure: expect.stringMatching(/MIME type/) }] })
    const mp4 = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0])
    const unavailable = await analyzeSourceInbox({ ...input([], null), videos: [{ name: 'video.mp4', mimeType: 'video/mp4', bytes: mp4 }] })
    expect(unavailable).toMatchObject({ status: 'failed', video_analyses: [{ failure: 'local video provider is not configured' }] })
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

  it('retains OCR warning, timestamp, hash, provider, version, confidence, and granularity on every outcome', async () => {
    const provider: MediaAnalysisProvider = { ...deterministicLocalImageProvider, async analyzeImage() { throw new Error('recognizer unavailable') } }
    const preview = await analyzeSourceInbox(input([{ name: 'failure.png', mimeType: 'image/png', bytes: png }], null), provider)
    expect(preview.analyses[0]).toMatchObject({
      image_sha256: preview.image_evidence[0].sha256,
      provider: 'deterministic-local',
      provider_version: '1',
      analyzed_at: '2026-09-16T00:00:00.000Z',
      confidence: null,
      granularity: 'unknown',
      review_state: 'failed',
      warnings: ['OCR could not be completed for this image.'],
      failure: 'recognizer unavailable',
    })
  })

  it('recognizes the known text in a deterministic local PNG through real offline Tesseract processing', async () => {
    const worker = await createWorker('eng', 1, { langPath: localEnglishData.langPath, cacheMethod: 'none' })
    try {
      const fixture = new Uint8Array(await readFile('test/fixtures/source-inbox-known-text.png'))
      const preview = await analyzeSourceInbox(input([{ name: 'source-inbox-known-text.png', mimeType: 'image/png', bytes: fixture }], null), createOfflineTesseractImageProvider({ recognize: async (bytes) => worker.recognize(Buffer.from(bytes)) }))
      expect(preview.analyses[0]).toMatchObject({ provider: 'tesseract.js-local', method: 'ocr', text_state: 'text', review_state: 'needs_review', ocr_text: expect.stringMatching(/BUGLASAN OCR TEST/i) })
    } finally {
      await worker.terminate()
    }
  }, 30_000)
})
