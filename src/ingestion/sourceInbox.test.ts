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
    expect(payload.source_metadata).toMatchObject({ source_inbox: { operator_caption: 'Official schedule' }, source_adapter: { authority_official: true, provenance: 'operator_provided' } })
    expect(payload.source_metadata.source_inbox).not.toHaveProperty('official_buglasan_source_verified')
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
    expect(() => approveSourceInboxPreview(preview, vi.fn(), { confirmOcrReview: true, confirmOfficialBuglasanSource: true })).not.toThrow()
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

  it('keeps caption, speech, and frame-OCR provenance separate while accepting valid no-speech video outcomes', async () => {
    const mp4 = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0])
    const videoOnlyProvider: MediaAnalysisProvider = {
      ...deterministicLocalImageProvider,
      async analyzeVideo(video, _bytes, analyzedAt) {
        return { video_sha256: video.sha256, provider: 'local-fixture', provider_version: '1', method: 'ffprobe+ffmpeg+tesseract+whisper.cpp', analyzed_at: analyzedAt, review_state: 'needs_review', transcript_state: 'no_text', transcript: null, duration_seconds: 3, frame_count: 1, frame_analyses: [], derived_evidence: '[FRAME 00:00:00.000 OCR] Event poster', observations: [], warnings: [], failure: null }
      },
    }
    const noSpeechWithOcr = await analyzeSourceInbox({ ...input([], null), videos: [{ name: 'poster.mp4', mimeType: 'video/mp4', bytes: mp4 }] }, videoOnlyProvider)
    expect(noSpeechWithOcr).toMatchObject({ status: 'ready_for_approval', usable_content: true, video_analyses: [{ transcript: null, transcript_state: 'no_text', failure: null }] })
    const noAudioWithOcr = await analyzeSourceInbox({ ...input([], null), videos: [{ name: 'silent.mp4', mimeType: 'video/mp4', bytes: mp4 }] }, videoOnlyProvider)
    expect(noAudioWithOcr).toMatchObject({ status: 'ready_for_approval', usable_content: true })
    const captionAndMusicOnly = await analyzeSourceInbox({ ...input([], 'Original operator caption'), videos: [{ name: 'music-only.mp4', mimeType: 'video/mp4', bytes: mp4 }] }, videoOnlyProvider)
    expect(captionAndMusicOnly).toMatchObject({ operator_caption: 'Original operator caption', status: 'ready_for_approval', video_analyses: [] })
    const approved = approveSourceInboxPreview(captionAndMusicOnly, vi.fn((payload) => payload), { confirmOcrReview: true })
    expect(approved.source_metadata).toMatchObject({ source_inbox: { operator_caption: 'Original operator caption', video_evidence: [{ name: 'music-only.mp4', validation: 'accepted' }], video_analyses: [] } })
    expect(approved.raw_text).toBe('Original operator caption')
  })

  it('uses an operator caption for MP4 evidence without invoking video analysis', async () => {
    const mp4 = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0])
    const analyzeVideo = vi.fn()
    const preview = await analyzeSourceInbox({ ...input([], 'Exact captured caption\nwith line breaks'), videos: [{ name: 'bundle-11.mp4', mimeType: 'video/mp4', bytes: mp4 }] }, { ...deterministicLocalImageProvider, analyzeVideo })
    const approved = approveSourceInboxPreview(preview, (payload) => payload)

    expect(preview).toMatchObject({ status: 'ready_for_approval', source_type: 'text', operator_caption: 'Exact captured caption\nwith line breaks', video_evidence: [{ validation: 'accepted' }], video_analyses: [] })
    expect(analyzeVideo).not.toHaveBeenCalled()
    expect(approved.raw_text).toBe('Exact captured caption\nwith line breaks')
    expect(approved.source_metadata).toMatchObject({ source_inbox: { video_analyses: [] } })
  })

  it('rejects failed video transcription despite useful diagnostic OCR and does not fabricate no-text content', async () => {
    const mp4 = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0])
    const failedProvider: MediaAnalysisProvider = {
      ...deterministicLocalImageProvider,
      async analyzeVideo(video, _bytes, analyzedAt) {
        return { video_sha256: video.sha256, provider: 'local-fixture', provider_version: '1', method: 'ffprobe+ffmpeg+tesseract+whisper.cpp', analyzed_at: analyzedAt, review_state: 'failed', transcript_state: 'unknown', transcript: null, duration_seconds: 3, frame_count: 1, frame_analyses: [], derived_evidence: '[FRAME 00:00:00.000 OCR] Diagnostic poster text', observations: [], warnings: ['Local audio transcription failed; retained visual analysis for diagnostics only.'], failure: 'Local audio transcription failed: whisper exited with code 1' }
      },
    }
    const failed = await analyzeSourceInbox({ ...input([], null), videos: [{ name: 'broken-audio.mp4', mimeType: 'video/mp4', bytes: mp4 }] }, failedProvider)
    expect(failed).toMatchObject({ status: 'failed', usable_content: false, video_analyses: [{ review_state: 'failed', transcript_state: 'unknown', transcript: null, failure: expect.stringMatching(/transcription failed/) }] })
    expect(() => approveSourceInboxPreview(failed, vi.fn())).toThrow(/Only usable/)
    const emptyProvider: MediaAnalysisProvider = { ...failedProvider, async analyzeVideo(video, _bytes, analyzedAt) { return { video_sha256: video.sha256, provider: 'local-fixture', provider_version: '1', method: 'ffprobe+ffmpeg+tesseract+whisper.cpp', analyzed_at: analyzedAt, review_state: 'not_required', transcript_state: 'no_text', transcript: null, duration_seconds: 3, frame_count: 0, frame_analyses: [], derived_evidence: '', observations: [], warnings: [], failure: null } } }
    const empty = await analyzeSourceInbox({ ...input([], null), videos: [{ name: 'empty.mp4', mimeType: 'video/mp4', bytes: mp4 }] }, emptyProvider)
    expect(empty).toMatchObject({ status: 'failed', usable_content: false, video_analyses: [{ transcript: null, transcript_state: 'no_text', derived_evidence: '' }] })
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
    await expect(analyzeSourceInbox({ ...input(), facebookPostUrl: 'https://www.facebook.com/HarborDays/posts/123' })).rejects.toThrow(/canonical/)
    expect((await analyzeSourceInbox(input([], 'Caption only'))).source_type).toBe('text')
    const reference = await analyzeSourceInbox(input([], null))
    expect(reference.status).toBe('reference_only')
    expect(() => approveSourceInboxPreview(reference, vi.fn())).toThrow(/Only usable/)
  })

  it('uses captured caption evidence for approved text sources without changing media provenance rules', async () => {
    const preview = await analyzeSourceInbox(input([], 'Captured official caption'))
    const approved = approveSourceInboxPreview(preview, (payload) => payload)

    expect(approved).toMatchObject({ source_type: 'text', raw_text: 'Captured official caption', normalized_text: 'Captured official caption' })
    expect(approved.source_metadata).toMatchObject({ source_inbox: { operator_caption: 'Captured official caption' } })
  })

  it('previews canonical reels structurally but requires an explicit official-source attestation before approval', async () => {
    const reel = await analyzeSourceInbox({ ...input(), facebookPostUrl: 'https://m.facebook.com/reel/123456789?fbclid=tracking' })
    expect(reel.reference.post_url).toBe('https://www.facebook.com/reel/123456789/')
    expect(reel.reference.identity).toBe('reel-123456789')
    expect(() => approveSourceInboxPreview(reel, vi.fn())).toThrow(/Official Buglasan source identity/)
    const dispatch = vi.fn((payload) => payload)
    const approved = approveSourceInboxPreview(reel, dispatch, { confirmOfficialBuglasanSource: true })
    expect(approved.post_url).toBe('https://www.facebook.com/reel/123456789/')
    expect(approved.post_url).not.toContain('/Buglasan/posts/')
    expect(approved.source_metadata).toMatchObject({ source_inbox: { official_buglasan_source_verified: true } })
    await expect(analyzeSourceInbox({ ...input(), facebookPostUrl: 'https://www.facebook.com/reel/' })).rejects.toThrow(/canonical/)
    await expect(analyzeSourceInbox({ ...input(), facebookPostUrl: 'https://www.facebook.com/reels/123' })).rejects.toThrow(/canonical/)
    await expect(analyzeSourceInbox({ ...input(), facebookPostUrl: 'https://www.facebook.com/OtherPage/reel/123' })).rejects.toThrow(/canonical/)
    await expect(analyzeSourceInbox({ ...input(), facebookPostUrl: 'https://www.facebook.com/reel/not-a-number/' })).rejects.toThrow(/numeric/)
    await expect(analyzeSourceInbox({ ...input(), facebookPostUrl: 'https://www.facebook.com/reel/123/extra' })).rejects.toThrow(/suffixes/)
    await expect(analyzeSourceInbox({ ...input(), facebookPostUrl: 'https://www.facebook.com/reel/123#fragment' })).rejects.toThrow(/suffixes/)
    await expect(analyzeSourceInbox({ ...input(), facebookPostUrl: 'https://www.facebook.com:444/reel/123/' })).rejects.toThrow(/ports/)
    await expect(analyzeSourceInbox({ ...input(), facebookPostUrl: 'https://operator:secret@www.facebook.com/reel/123/' })).rejects.toThrow(/credentials/)
    await expect(analyzeSourceInbox({ ...input(), facebookPostUrl: 'https://www.facebook.com.evil.example/reel/123/' })).rejects.toThrow(/canonical/)
    await expect(analyzeSourceInbox({ ...input(), facebookPostUrl: 'https://www.facebook.com/reel/123https://evil.example/' })).rejects.toThrow(/numeric/)
    await expect(analyzeSourceInbox({ ...input(), facebookPostUrl: 'https://www.facebook.com/reel/123?next=https%3A%2F%2Fevil.example' })).rejects.toThrow(/embedded URLs/)
  })

  it('uses canonical Facebook references as source identities without collapsing distinct evidence', async () => {
    const shared = { ...input(), operatorCaption: 'Same supplied evidence' }
    const reel = await analyzeSourceInbox({ ...shared, facebookPostUrl: 'https://www.facebook.com/reel/1957716848966423/' })
    const sameReel = await analyzeSourceInbox({ ...shared, facebookPostUrl: 'https://www.facebook.com/reel/1957716848966423/' })
    const post = await analyzeSourceInbox({ ...shared, facebookPostUrl: 'https://www.facebook.com/Buglasan/posts/1475245514640502/' })
    const samePost = await analyzeSourceInbox({ ...shared, facebookPostUrl: 'https://www.facebook.com/Buglasan/posts/1475245514640502/' })

    const approvedReel = approveSourceInboxPreview(reel, (payload) => payload, { confirmOfficialBuglasanSource: true })
    const approvedSameReel = approveSourceInboxPreview(sameReel, (payload) => payload, { confirmOfficialBuglasanSource: true })
    const approvedPost = approveSourceInboxPreview(post, (payload) => payload)
    const approvedSamePost = approveSourceInboxPreview(samePost, (payload) => payload)

    expect(approvedReel).toMatchObject({ post_id: 'reel-1957716848966423', post_url: 'https://www.facebook.com/reel/1957716848966423/', source_metadata: { source_inbox: { replay_key: reel.replay_key }, source_adapter: { provenance: 'operator_provided' } } })
    expect(approvedSameReel.post_id).toBe(approvedReel.post_id)
    expect(approvedSameReel.post_url).toBe(approvedReel.post_url)
    expect(approvedPost).toMatchObject({ post_id: '1475245514640502', post_url: 'https://www.facebook.com/Buglasan/posts/1475245514640502/', source_metadata: { source_inbox: { replay_key: post.replay_key }, source_adapter: { provenance: 'operator_provided' } } })
    expect(approvedSamePost.post_id).toBe(approvedPost.post_id)
    expect(approvedSamePost.post_url).toBe(approvedPost.post_url)
    expect(approvedReel.post_id).not.toBe(approvedPost.post_id)
    expect(approvedReel.post_url).not.toBe(approvedPost.post_url)
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
