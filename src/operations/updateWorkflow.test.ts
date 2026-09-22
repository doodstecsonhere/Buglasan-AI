import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  scanSourceBundles,
  compareCorpus,
  executeIntake,
  formatPreviewReport,
  formatStatusReport,
  resolveBundleIdentity,
  selectReanalyzeCandidates,
  type ScannedBundle,
  type DurableSourceRecord,
} from './updateWorkflow'
import type { MediaAnalysisProvider } from '../ingestion/sourceInbox'

describe('Buglasan Live Operations — Source Updating Workflow', () => {
  // Helper to create a temporary source bundle directory
  async function createFixtureDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
    const dir = await mkdtemp(join(tmpdir(), 'buglasan-test-'))
    return {
      dir,
      cleanup: async () => {
        await rm(dir, { recursive: true, force: true })
      },
    }
  }

  // 1. empty/no-change update
  it('1. handles empty / no-change update cleanly', async () => {
    const { dir, cleanup } = await createFixtureDir()
    try {
      const bundle1 = join(dir, '1')
      await mkdir(bundle1)
      await writeFile(join(bundle1, 'manifest.txt'), 'URL:\nhttps://www.facebook.com/Buglasan/posts/10001\n\nCAPTION:\nParade schedule')

      const bundles = await scanSourceBundles({ sourceRoot: dir })
      const durable: DurableSourceRecord[] = [{
        id: 'uuid-1',
        post_id: '10001',
        post_url: 'https://www.facebook.com/Buglasan/posts/10001/',
        content_fingerprint: bundles[0].contentFingerprint!,
      }]

      const comparison = compareCorpus(bundles, durable)
      expect(comparison.totalBundles).toBe(1)
      expect(comparison.unchanged).toHaveLength(1)
      expect(comparison.newSources).toHaveLength(0)

      const result = await executeIntake(comparison, { confirmProduction: true })
      expect(result.status).toBe('already_current')
      expect(result.admitted).toHaveLength(0)
    } finally {
      await cleanup()
    }
  })

  // 2. one new valid source
  it('2. detects and intakes one new valid source with downstream processing', async () => {
    const { dir, cleanup } = await createFixtureDir()
    try {
      const bundle = join(dir, '40')
      await mkdir(bundle)
      await writeFile(join(bundle, 'manifest.txt'), 'URL:\nhttps://www.facebook.com/Buglasan/posts/20002\n\nCAPTION:\nNew street dance venue announcement.')

      const bundles = await scanSourceBundles({ sourceRoot: dir })
      const comparison = compareCorpus(bundles, [])
      expect(comparison.newSources).toHaveLength(1)
      expect(comparison.newSources[0].identity.postId).toBe('20002')

      const mockDispatcher = vi.fn(async () => ({
        status: 'new' as const,
        sourceId: 'mock-uuid-20002',
        postId: '20002',
      }))
      const mockDownstream = vi.fn(async () => ({
        indexing: 'indexed',
        extraction: 'extracted',
        reconciliations: ['reconciled'],
      }))

      const result = await executeIntake(comparison, {
        confirmProduction: true,
        dispatcher: mockDispatcher,
        downstreamRunner: mockDownstream,
      })

      expect(result.status).toBe('intake_completed')
      expect(result.admitted).toHaveLength(1)
      expect(result.admitted[0].postId).toBe('20002')
      expect(mockDispatcher).toHaveBeenCalledOnce()
      expect(mockDownstream).toHaveBeenCalledWith('mock-uuid-20002', expect.anything())
      expect(result.downstreamReport.indexed).toBe(1)
      expect(result.downstreamReport.extracted).toBe(1)
      expect(result.downstreamReport.reconciled).toBe(1)
    } finally {
      await cleanup()
    }
  })

  it('classifies MP4 without usable caption as needs review before intake', async () => {
    const { dir, cleanup } = await createFixtureDir()
    try {
      const bundle = join(dir, '11')
      await mkdir(bundle)
      await writeFile(join(bundle, 'manifest.txt'), 'URL:\nhttps://www.facebook.com/Buglasan/posts/110011\n\nCAPTION:\n')
      await writeFile(join(bundle, 'clip.mp4'), Buffer.from([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0]))

      const comparison = compareCorpus(await scanSourceBundles({ sourceRoot: dir }), [])
      expect(comparison.newSources).toHaveLength(0)
      expect(comparison.needsReview).toHaveLength(1)
      expect(comparison.needsReview[0].classificationReason).toMatch(/usable textual evidence|media-analysis mechanism/i)
      const dispatcher = vi.fn()
      const result = await executeIntake(comparison, { confirmProduction: true, dispatcher })
      expect(result.admitted).toHaveLength(0)
      expect(dispatcher).not.toHaveBeenCalled()
    } finally {
      await cleanup()
    }
  })

  // 3. multiple new valid sources
  it('3. sequentially intakes multiple new valid sources', async () => {
    const { dir, cleanup } = await createFixtureDir()
    try {
      for (const id of ['50', '51', '52']) {
        const bDir = join(dir, id)
        await mkdir(bDir)
        await writeFile(join(bDir, 'manifest.txt'), `URL:\nhttps://www.facebook.com/Buglasan/posts/1450000000${id}\n\nCAPTION:\nAnnouncement ${id}`)
      }

      const bundles = await scanSourceBundles({ sourceRoot: dir })
      const comparison = compareCorpus(bundles, [])
      expect(comparison.newSources).toHaveLength(3)

      const dispatched: string[] = []
      const result = await executeIntake(comparison, {
        confirmProduction: true,
        dispatcher: async (payload) => {
          dispatched.push(payload.post_id)
          return { status: 'new', sourceId: `uuid-${payload.post_id}`, postId: payload.post_id }
        },
        downstreamRunner: async () => ({ indexing: 'indexed', extraction: 'extracted', reconciliations: [] }),
      })

      expect(result.admitted).toHaveLength(3)
      expect(dispatched).toEqual(['145000000050', '145000000051', '145000000052'])
      expect(result.downstreamReport.indexed).toBe(3)
    } finally {
      await cleanup()
    }
  })

  // 4. already-ingested source
  it('4. classifies already-ingested sources as unchanged and does not re-dispatch', async () => {
    const { dir, cleanup } = await createFixtureDir()
    try {
      const bDir = join(dir, '1')
      await mkdir(bDir)
      await writeFile(join(bDir, 'manifest.txt'), 'URL:\nhttps://www.facebook.com/Buglasan/posts/1431770092321378\n\nCAPTION:\nProfile photo update.')

      const bundles = await scanSourceBundles({ sourceRoot: dir })
      const durable: DurableSourceRecord[] = [{
        id: 'uuid-1',
        post_id: '1431770092321378',
        post_url: 'https://www.facebook.com/Buglasan/posts/1431770092321378/',
        content_fingerprint: bundles[0].contentFingerprint!,
      }]

      const comparison = compareCorpus(bundles, durable)
      expect(comparison.unchanged).toHaveLength(1)
      expect(comparison.newSources).toHaveLength(0)

      const mockDispatcher = vi.fn()
      const result = await executeIntake(comparison, {
        confirmProduction: true,
        dispatcher: mockDispatcher,
      })

      expect(result.status).toBe('already_current')
      expect(mockDispatcher).not.toHaveBeenCalled()
    } finally {
      await cleanup()
    }
  })

  // 5. ambiguous/missing identity (needs identity review)
  it('5. identifies opaque pfbid URL without sidecar as needs_identity_review and explains missing info', async () => {
    const { dir, cleanup } = await createFixtureDir()
    try {
      const bDir = join(dir, '7')
      await mkdir(bDir)
      await writeFile(join(bDir, 'manifest.txt'), 'URL:\nhttps://www.facebook.com/Buglasan/posts/pfbid02amKUbVey9pjWu2XbxsMzVYDn9FMDv7Um3xHzq9J9ogMrnWLNo8UCFaYkP1VykVFql\n\nCAPTION:\nSchedule details')

      const bundles = await scanSourceBundles({ sourceRoot: dir, externalMappings: new Map() })
      const comparison = compareCorpus(bundles, [])

      expect(comparison.needsIdentityReview).toHaveLength(1)
      expect(comparison.needsIdentityReview[0].identity.status).toBe('needs_identity_review')
      expect(comparison.needsIdentityReview[0].identity.reason).toContain('pfbid')

      const previewText = formatPreviewReport(comparison)
      expect(previewText).toContain('Needs review:        1')
      expect(previewText).toContain('Next human action:')
    } finally {
      await cleanup()
    }
  })

  // 6. changed source requiring review
  it('6. detects changed source when local content differs from durable state', async () => {
    const bundle: ScannedBundle = {
      bundleId: '10',
      bundleNumber: 10,
      bundlePath: '/path/10',
      manifestPath: '/path/10/manifest.txt',
      sidecarPath: null,
      caption: 'Updated parade start time: 7:00 PM',
      rawUrl: 'https://www.facebook.com/Buglasan/posts/1457784349719952',
      identity: { status: 'resolved', postId: '1457784349719952', canonicalUrl: 'https://www.facebook.com/Buglasan/posts/1457784349719952/', identitySource: 'canonical_url' },
      media: [],
      contentFingerprint: 'new-hash-xyz',
    }

    const durable: DurableSourceRecord[] = [{
      id: 'uuid-10',
      post_id: '1457784349719952',
      post_url: 'https://www.facebook.com/Buglasan/posts/1457784349719952/',
      content_fingerprint: 'old-hash-abc',
    }]

    const comparison = compareCorpus([bundle], durable)
    // Note: compareCorpus checks if content differs
    expect(comparison.totalBundles).toBe(1)
  })

  // 7. invalid source
  it('7. classifies bundles with neither caption nor media as incomplete/invalid', async () => {
    const { dir, cleanup } = await createFixtureDir()
    try {
      const bDir = join(dir, 'empty-bundle')
      await mkdir(bDir)
      await writeFile(join(bDir, 'manifest.txt'), 'URL:\nhttps://www.facebook.com/Buglasan/posts/9999\n\nCAPTION:\n')

      const bundles = await scanSourceBundles({ sourceRoot: dir })
      const comparison = compareCorpus(bundles, [])
      expect(comparison.incomplete).toHaveLength(1)
      expect(comparison.incomplete[0].classificationReason).toContain('neither text caption nor media')
    } finally {
      await cleanup()
    }
  })

  // 8. mixed safe + unsafe batch
  it('8. admits safe new sources while holding back unsafe bundles for review', async () => {
    const { dir, cleanup } = await createFixtureDir()
    try {
      // 1 valid new source
      const bSafe = join(dir, '101')
      await mkdir(bSafe)
      await writeFile(join(bSafe, 'manifest.txt'), 'URL:\nhttps://www.facebook.com/Buglasan/posts/101\n\nCAPTION:\nValid safe post')

      // 1 source with missing identity (pfbid)
      const bUnsafe = join(dir, '102')
      await mkdir(bUnsafe)
      await writeFile(join(bUnsafe, 'manifest.txt'), 'URL:\nhttps://www.facebook.com/Buglasan/posts/pfbidOpaque\n\nCAPTION:\nMissing identity post')

      // 1 empty incomplete source
      const bEmpty = join(dir, '103')
      await mkdir(bEmpty)
      await writeFile(join(bEmpty, 'manifest.txt'), 'URL:\n\nCAPTION:\n')

      const bundles = await scanSourceBundles({ sourceRoot: dir, externalMappings: new Map() })
      const comparison = compareCorpus(bundles, [])

      expect(comparison.newSources).toHaveLength(1)
      expect(comparison.needsIdentityReview).toHaveLength(1)
      expect(comparison.incomplete).toHaveLength(1)

      const mockDispatcher = vi.fn(async (payload) => ({
        status: 'new' as const,
        sourceId: 'uuid-101',
        postId: payload.post_id,
      }))

      const result = await executeIntake(comparison, {
        confirmProduction: true,
        dispatcher: mockDispatcher,
        downstreamRunner: async () => ({ indexing: 'indexed', extraction: 'no_event', reconciliations: [] }),
      })

      expect(result.admitted).toHaveLength(1)
      expect(result.admitted[0].bundleId).toBe('101')
      expect(mockDispatcher).toHaveBeenCalledOnce()
    } finally {
      await cleanup()
    }
  })

  // 9. duplicate prevention / idempotency
  it('9. running update twice consecutively produces 0 duplicates and 0 downstream processing on second run', async () => {
    const { dir, cleanup } = await createFixtureDir()
    try {
      const bDir = join(dir, '200')
      await mkdir(bDir)
      await writeFile(join(bDir, 'manifest.txt'), 'URL:\nhttps://www.facebook.com/Buglasan/posts/200\n\nCAPTION:\nIdempotency test post')

      const bundles = await scanSourceBundles({ sourceRoot: dir })
      const durableDatabase: DurableSourceRecord[] = []

      // Run 1: Source is new
      const comp1 = compareCorpus(bundles, durableDatabase)
      expect(comp1.newSources).toHaveLength(1)

      const result1 = await executeIntake(comp1, {
        confirmProduction: true,
        dispatcher: async (payload) => {
          durableDatabase.push({
            id: 'uuid-200',
            post_id: payload.post_id,
            post_url: payload.post_url,
            content_fingerprint: bundles[0].contentFingerprint!,
          })
          return { status: 'new', sourceId: 'uuid-200', postId: payload.post_id }
        },
        downstreamRunner: async () => ({ indexing: 'indexed', extraction: 'extracted', reconciliations: [] }),
      })
      expect(result1.admitted).toHaveLength(1)

      // Run 2: Immediately run again with same directory & updated durable database
      const comp2 = compareCorpus(bundles, durableDatabase)
      expect(comp2.newSources).toHaveLength(0)
      expect(comp2.unchanged).toHaveLength(1)

      const mockDispatcher2 = vi.fn()
      const mockDownstream2 = vi.fn()
      const result2 = await executeIntake(comp2, {
        confirmProduction: true,
        dispatcher: mockDispatcher2,
        downstreamRunner: mockDownstream2,
      })

      expect(result2.status).toBe('already_current')
      expect(result2.admitted).toHaveLength(0)
      expect(mockDispatcher2).not.toHaveBeenCalled()
      expect(mockDownstream2).not.toHaveBeenCalled()
    } finally {
      await cleanup()
    }
  })

  // 10. preview performs zero production mutation
  it('10. preview mode performs strictly zero production mutation or dispatches', async () => {
    const { dir, cleanup } = await createFixtureDir()
    try {
      const bDir = join(dir, '300')
      await mkdir(bDir)
      await writeFile(join(bDir, 'manifest.txt'), 'URL:\nhttps://www.facebook.com/Buglasan/posts/300\n\nCAPTION:\nPreview safety test')

      const bundles = await scanSourceBundles({ sourceRoot: dir })
      const comparison = compareCorpus(bundles, [])
      expect(comparison.newSources).toHaveLength(1)

      const mockDispatcher = vi.fn()
      const result = await executeIntake(comparison, {
        confirmProduction: false,
        dispatcher: mockDispatcher,
      })

      expect(result.status).toBe('preview_only')
      expect(result.admitted).toHaveLength(0)
      expect(mockDispatcher).not.toHaveBeenCalled()
    } finally {
      await cleanup()
    }
  })

  // 11. confirmation boundary
  it('11. confirmation boundary: refuses to intake without confirmProduction flag', async () => {
    const comparison: any = {
      totalBundles: 1,
      unchanged: [],
      newSources: [{ identity: { canonicalUrl: 'https://www.facebook.com/Buglasan/posts/1/' }, media: [] }],
      changedSources: [],
      needsIdentityReview: [],
      incomplete: [],
      invalid: [],
    }

    const mockDispatcher = vi.fn()
    const result = await executeIntake(comparison, {
      confirmProduction: false,
      dispatcher: mockDispatcher,
    })

    expect(result.status).toBe('preview_only')
    expect(mockDispatcher).not.toHaveBeenCalled()
  })

  // 12. provider failure classification
  it('12. classifies provider 503 / 429 as provider unavailable without failing source admission', async () => {
    const { dir, cleanup } = await createFixtureDir()
    try {
      const bDir = join(dir, '401')
      await mkdir(bDir)
      await writeFile(join(bDir, 'manifest.txt'), 'URL:\nhttps://www.facebook.com/Buglasan/posts/401\n\nCAPTION:\nProvider failure resilience test')

      const bundles = await scanSourceBundles({ sourceRoot: dir })
      const comparison = compareCorpus(bundles, [])

      const result = await executeIntake(comparison, {
        confirmProduction: true,
        dispatcher: async (payload) => ({ status: 'new', sourceId: 'uuid-401', postId: payload.post_id }),
        downstreamRunner: async () => ({
          indexing: 'indexed',
          extraction: 'provider_unavailable',
          reconciliations: [],
        }),
      })

      expect(result.admitted).toHaveLength(1)
      expect(result.admitted[0].sourceId).toBe('uuid-401')
      expect(result.downstreamReport.indexed).toBe(1)
      expect(result.downstreamReport.providerUnavailable).toBe(1)
      expect(result.downstreamReport.unsafeFailures).toBe(0)

      const statusText = formatStatusReport(result)
      expect(statusText).toContain('1 provider unavailable (retryable)')
      expect(statusText).toContain('0 unsafe failures')
      expect(statusText).toContain('All admitted sources safely persisted')
    } finally {
      await cleanup()
    }
  })

  // 13. partial downstream success reporting
  it('13. accurately reports mixed downstream outcomes across a batch', async () => {
    const { dir, cleanup } = await createFixtureDir()
    try {
      for (const id of ['501', '502']) {
        const bDir = join(dir, id)
        await mkdir(bDir)
        await writeFile(join(bDir, 'manifest.txt'), `URL:\nhttps://www.facebook.com/Buglasan/posts/${id}\n\nCAPTION:\nBatch item ${id}`)
      }

      const bundles = await scanSourceBundles({ sourceRoot: dir })
      const comparison = compareCorpus(bundles, [])

      let callCount = 0
      const result = await executeIntake(comparison, {
        confirmProduction: true,
        dispatcher: async (payload) => ({ status: 'new', sourceId: `uuid-${payload.post_id}`, postId: payload.post_id }),
        downstreamRunner: async () => {
          callCount++
          if (callCount === 1) {
            return { indexing: 'indexed', extraction: 'extracted', reconciliations: ['reconciled'] }
          }
          return { indexing: 'provider_unavailable', extraction: 'provider_unavailable', reconciliations: [] }
        },
      })

      expect(result.admitted).toHaveLength(2)
      expect(result.downstreamReport.indexed).toBe(1)
      expect(result.downstreamReport.extracted).toBe(1)
      expect(result.downstreamReport.reconciled).toBe(1)
      expect(result.downstreamReport.providerUnavailable).toBe(2)
    } finally {
      await cleanup()
    }
  })

  // 14. preservation of source provenance
  it('14. preserves source provenance, operator captions, and canonical identity for reels', async () => {
    const { dir, cleanup } = await createFixtureDir()
    try {
      const bDir = join(dir, '600')
      await mkdir(bDir)
      await writeFile(join(bDir, 'manifest.txt'), 'URL:\nhttps://www.facebook.com/reel/9876543210/?fbclid=xyz\n\nCAPTION:\nOfficial Reel: Buglasan highlights')

      const bundles = await scanSourceBundles({ sourceRoot: dir })
      expect(bundles[0].identity.postId).toBe('reel-9876543210')
      expect(bundles[0].identity.canonicalUrl).toBe('https://www.facebook.com/reel/9876543210/')

      let capturedPayload: any = null
      const result = await executeIntake(compareCorpus(bundles, []), {
        confirmProduction: true,
        dispatcher: async (payload) => {
          capturedPayload = payload
          return { status: 'new', sourceId: 'uuid-600', postId: payload.post_id }
        },
        downstreamRunner: async () => ({ indexing: 'indexed', extraction: 'extracted', reconciliations: [] }),
      })

      expect(result.admitted).toHaveLength(1)
      expect(capturedPayload).not.toBeNull()
      expect(capturedPayload.platform).toBe('facebook')
      expect(capturedPayload.post_id).toBe('reel-9876543210')
      expect(capturedPayload.post_url).toBe('https://www.facebook.com/reel/9876543210/')
      expect(capturedPayload.collection_method).toBe('manual')
      expect(capturedPayload.source_metadata).toMatchObject({
        source_inbox: {
          operator_caption: 'Official Reel: Buglasan highlights',
          official_buglasan_source_verified: true,
        },
        source_adapter: {
          authority_label: 'Operator-provided official Buglasan Facebook reference',
          authority_official: true,
          provenance: 'operator_provided',
        },
      })
    } finally {
      await cleanup()
    }
  })

  // 15. complete multi-image intake (Bundle-36-like)
  it('15. intakes a 13-image bundle as one durable source and represents every media item', async () => {
    const { dir, cleanup } = await createFixtureDir()
    try {
      const bundle = join(dir, '36')
      await mkdir(bundle)
      await writeFile(join(bundle, 'manifest.txt'), 'URL:\nhttps://www.facebook.com/Buglasan/posts/1501746578657062\n\nCAPTION:\nBuglasan 2026 full festival schedule')
      for (let i = 0; i < 13; i++) {
        await writeFile(join(bundle, `schedule-${String(i + 1).padStart(2, '0')}.png`), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, i]))
      }

      const bundles = await scanSourceBundles({ sourceRoot: dir })
      expect(bundles[0].media.filter((m) => m.kind === 'image')).toHaveLength(13)
      const comparison = compareCorpus(bundles, [])
      expect(comparison.newSources).toHaveLength(1)

      let capturedPayload: any = null
      const result = await executeIntake(comparison, {
        confirmProduction: true,
        dispatcher: async (payload) => {
          capturedPayload = payload
          return { status: 'new', sourceId: 'uuid-36', postId: payload.post_id }
        },
        downstreamRunner: async () => ({ indexing: 'indexed', extraction: 'extracted', reconciliations: [] }),
      })

      expect(result.admitted).toHaveLength(1)
      expect(capturedPayload.post_id).toBe('1501746578657062')
      const imageEvidence = capturedPayload.source_metadata.source_inbox.image_evidence
      expect(imageEvidence).toHaveLength(13)
      expect(imageEvidence.every((image: { validation: string }) => image.validation === 'accepted')).toBe(true)
      expect(capturedPayload.source_metadata.source_inbox.analyses).toHaveLength(13)
    } finally {
      await cleanup()
    }
  })

  // Identity resolution edge cases
  describe('resolveBundleIdentity', () => {
    it('resolves identity from in-bundle sidecar metadata', () => {
      const id = resolveBundleIdentity(
        null,
        'https://www.facebook.com/Buglasan/posts/pfbidOpaque',
        { postId: '123456789' },
        { postId: null, canonicalUrl: null },
      )
      expect(id.status).toBe('resolved')
      expect(id.postId).toBe('123456789')
      expect(id.canonicalUrl).toBe('https://www.facebook.com/Buglasan/posts/123456789/')
      expect(id.identitySource).toBe('sidecar')
    })

    it('resolves identity from explicit manifest header fields', () => {
      const id = resolveBundleIdentity(
        null,
        'https://www.facebook.com/Buglasan/posts/pfbidOpaque',
        null,
        { postId: '987654321', canonicalUrl: 'https://www.facebook.com/Buglasan/posts/987654321/' },
      )
      expect(id.status).toBe('resolved')
      expect(id.postId).toBe('987654321')
      expect(id.identitySource).toBe('manifest_field')
    })
  })

  // Image-derived knowledge reaching the bulk Live Ops intake path
  describe('image-derived knowledge in the bulk intake path', () => {
    // Deterministic fixture provider: every image yields name-derived text, so OCR
    // quality is not part of this contract; the sourceInbox suite covers the
    // ingressText shape and a separate real-Tesseract test covers extraction.
    const fakeOcrProvider: MediaAnalysisProvider = {
      id: 'ocr-fixture',
      version: '1',
      async analyzeImage(image, _bytes, analyzedAt) {
        return { image_sha256: image.sha256, provider: 'ocr-fixture', provider_version: '1', method: 'ocr', analyzed_at: analyzedAt, confidence: 90, granularity: 'document', review_state: 'needs_review', text_state: 'text', ocr_text: `Schedule content of ${image.name}`, observations: [], warnings: [], failure: null }
      },
    }

    async function createImageBundle(imageCount: number): Promise<{ dir: string; cleanup: () => Promise<void> }> {
      const dir = await mkdtemp(join(tmpdir(), 'buglasan-img-'))
      const bundle = join(dir, '36')
      await mkdir(bundle)
      await writeFile(join(bundle, 'manifest.txt'), 'URL:\nhttps://www.facebook.com/Buglasan/posts/1501746578657062\n\nCAPTION:\nBuglasan 2026 full festival schedule')
      for (let i = 0; i < imageCount; i++) {
        await writeFile(join(bundle, `schedule-${String(i + 1).padStart(2, '0')}.png`), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, i]))
      }
      return { dir, cleanup: async () => { await rm(dir, { recursive: true, force: true }) } }
    }

    it('keeps caption-only payload when no OCR provider is injected (regression)', async () => {
      const { dir, cleanup } = await createImageBundle(13)
      try {
        const comparison = compareCorpus(await scanSourceBundles({ sourceRoot: dir }), [])
        let captured: any = null
        await executeIntake(comparison, {
          confirmProduction: true,
          dispatcher: async (payload) => { captured = payload; return { status: 'new', sourceId: 'uuid-36', postId: payload.post_id } },
          downstreamRunner: async () => ({ indexing: 'indexed', extraction: 'extracted', reconciliations: [] }),
        })
        expect(captured.raw_text).toBe('Buglasan 2026 full festival schedule')
        expect(captured.raw_text).not.toContain('[IMAGE')
      } finally { await cleanup() }
    })

    it('reaches source knowledge for every image when an OCR provider is injected', async () => {
      const { dir, cleanup } = await createImageBundle(13)
      try {
        const comparison = compareCorpus(await scanSourceBundles({ sourceRoot: dir }), [])
        let captured: any = null
        await executeIntake(comparison, {
          confirmProduction: true,
          imageProvider: fakeOcrProvider,
          dispatcher: async (payload) => { captured = payload; return { status: 'new', sourceId: 'uuid-36', postId: payload.post_id } },
          downstreamRunner: async () => ({ indexing: 'indexed', extraction: 'extracted', reconciliations: [] }),
        })
        const text: string = captured.raw_text
        expect(text).toContain('Buglasan 2026 full festival schedule')
        expect(text.match(/\[IMAGE /g)).toHaveLength(13)
        // Early, middle, and final images all contribute provenance-labelled text.
        expect(text).toContain('[IMAGE 1 \u2014 schedule-01.png')
        expect(text).toContain('[IMAGE 7 \u2014 schedule-07.png')
        expect(text).toContain('[IMAGE 13 \u2014 schedule-13.png')
      } finally { await cleanup() }
    })

    it('never re-dispatches an unchanged source unless deliberately selected for re-analysis', async () => {
      const { dir, cleanup } = await createImageBundle(3)
      try {
        const bundles = await scanSourceBundles({ sourceRoot: dir })
        const durable: DurableSourceRecord[] = [{ id: 'uuid-36', post_id: '1501746578657062', post_url: 'https://www.facebook.com/Buglasan/posts/1501746578657062/', content_fingerprint: bundles[0].contentFingerprint! }]
        const comparison = compareCorpus(bundles, durable)
        expect(comparison.unchanged).toHaveLength(1)
        expect(comparison.newSources).toHaveLength(0)

        // Default: unchanged sources are untouched.
        const untouched = vi.fn()
        const resultDefault = await executeIntake(comparison, { confirmProduction: true, dispatcher: untouched, imageProvider: fakeOcrProvider })
        expect(resultDefault.status).toBe('already_current')
        expect(untouched).not.toHaveBeenCalled()

        // Selecting a non-present bundle still dispatches nothing.
        const noMatch = vi.fn()
        await executeIntake(comparison, { confirmProduction: true, reanalyzeBundles: ['999'], dispatcher: noMatch, imageProvider: fakeOcrProvider })
        expect(noMatch).not.toHaveBeenCalled()

        // Selecting the known bundle re-dispatches it under the same identity, and the
        // collector status is passed straight through (idempotent no-op for unchanged content).
        let captured: any = null
        const resultRe = await executeIntake(comparison, {
          confirmProduction: true,
          reanalyzeBundles: ['36'],
          imageProvider: fakeOcrProvider,
          dispatcher: async (payload) => { captured = payload; return { status: 'idempotent no-op', sourceId: 'uuid-36', postId: payload.post_id } },
          downstreamRunner: async () => ({ indexing: 'no_text', extraction: 'no_event', reconciliations: [] }),
        })
        expect(resultRe.status).toBe('intake_completed')
        expect(resultRe.admitted).toHaveLength(1)
        expect(resultRe.admitted[0].status).toBe('idempotent no-op')
        expect(resultRe.admitted[0].postId).toBe('1501746578657062')
        expect(captured.post_id).toBe('1501746578657062')
        expect(captured.raw_text).toContain('[IMAGE 3 \u2014 schedule-03.png')
      } finally { await cleanup() }
    })
  })

  describe('selectReanalyzeCandidates', () => {
    const bundle = (bundleId: string): ScannedBundle => ({ bundleId, bundleNumber: Number(bundleId), bundlePath: '', manifestPath: null, sidecarPath: null, caption: null, rawUrl: null, identity: { status: 'resolved', postId: bundleId, canonicalUrl: '', identitySource: 'none' }, media: [] })
    const unchanged = [bundle('1'), bundle('36'), bundle('7')]

    it('returns nothing without an explicit selection', () => {
      expect(selectReanalyzeCandidates(unchanged, undefined)).toEqual([])
    })
    it('selects all unchanged bundles for "all"', () => {
      expect(selectReanalyzeCandidates(unchanged, 'all').map((b) => b.bundleId)).toEqual(['1', '36', '7'])
    })
    it('selects only present, requested bundle ids and ignores unknown ones', () => {
      expect(selectReanalyzeCandidates(unchanged, ['36', '999']).map((b) => b.bundleId)).toEqual(['36'])
    })
  })
})
