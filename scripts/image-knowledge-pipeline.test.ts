import { describe, expect, it } from 'vitest'
import {
  analyzeSourceInbox,
  approveSourceInboxPreview,
  type MediaAnalysisProvider,
} from '../src/ingestion/sourceInbox.ts'
import { normalizeSourceIngestionPayload } from '../src/ingestion/sourceIngestion.ts'
import { chunkSourceText } from '../supabase/functions/_shared/chunking.ts'

/**
 * Local knowledge-pipeline contract: image-derived text must survive from OCR
 * analysis, through the approved ingress text and payload normalization, all the
 * way to the indexing chunk boundary. It uses a deterministic provider so OCR
 * quality is out of scope here; the committed acceptance runner and the real-Tesseract
 * sourceInbox test cover extraction quality. No production mutation or live calls.
 */
describe('image-derived knowledge reaches the indexing pipeline', () => {
  const images = Array.from({ length: 13 }, (_, i) => ({
    name: `schedule-${String(i + 1).padStart(2, '0')}.png`,
    mimeType: 'image/png' as const,
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, i]),
  }))

  const ocrProvider: MediaAnalysisProvider = {
    id: 'pipeline-fixture',
    version: '1',
    async analyzeImage(image, _bytes, analyzedAt) {
      const text = `UNIQUE-MARKER-${image.name} OCTOBER ${image.name} 6PM FREEDOM PARK STAGE`
      return { image_sha256: image.sha256, provider: 'pipeline-fixture', provider_version: '1', method: 'ocr', analyzed_at: analyzedAt, confidence: 90, granularity: 'document', review_state: 'needs_review', text_state: 'text', ocr_text: text, observations: [], warnings: [], failure: null }
    },
  }

  it('carries every image section from analysis through payload into index chunks', async () => {
    const preview = await analyzeSourceInbox({
      facebookPostUrl: 'https://www.facebook.com/Buglasan/posts/1501746578657062',
      operatorCaption: 'Buglasan 2026 full festival schedule',
      images,
      videos: [],
      collectedAt: '2026-09-20T00:00:00.000Z',
      festivalYear: 2026,
    }, ocrProvider)

    const payload = approveSourceInboxPreview(preview, (p) => p, { confirmOcrReview: true })

    // The approved payload is the exact object handed to the collector; it must
    // normalize cleanly and its indexing text must carry every image contribution.
    const normalized = normalizeSourceIngestionPayload(payload)
    const indexingText = normalized.normalized_text ?? normalized.raw_text ?? ''
    expect(indexingText).toContain('Buglasan 2026 full festival schedule')

    // index-source chunks `normalized_text ?? raw_text`; every contributing image
    // must appear in at least one chunk so nothing is silently dropped at the
    // 1200/1600-char boundary, including the final (13th) image.
    const chunks = await chunkSourceText(indexingText)
    expect(chunks.length).toBeGreaterThan(1)
    const allChunkText = chunks.map((chunk) => chunk.content).join('\n')
    for (const image of images) {
      expect(allChunkText).toContain(`UNIQUE-MARKER-${image.name}`)
    }
    expect(allChunkText).toContain('UNIQUE-MARKER-schedule-13.png')

    // Provenance headers survive chunking too, so each retained fragment stays
    // traceable to its ordinal, filename, and content hash.
    const headerCount = (allChunkText.match(/\[IMAGE \d+ \u2014 /g) ?? []).length
    expect(headerCount).toBe(13)
  })

  it('gives an image-only source real retrievable text where the caption alone had none', async () => {
    const preview = await analyzeSourceInbox({
      facebookPostUrl: 'https://www.facebook.com/Buglasan/posts/1501746578657062',
      operatorCaption: null,
      images,
      videos: [],
      collectedAt: '2026-09-20T00:00:00.000Z',
      festivalYear: 2026,
    }, ocrProvider)
    const payload = approveSourceInboxPreview(preview, (p) => p, { confirmOcrReview: true })
    const indexingText = payload.normalized_text ?? payload.raw_text ?? ''
    expect(indexingText.length).toBeGreaterThan(0)
    const chunks = await chunkSourceText(indexingText)
    expect(chunks.map((chunk) => chunk.content).join('\n')).toContain('UNIQUE-MARKER-schedule-01.png')
  })
})
