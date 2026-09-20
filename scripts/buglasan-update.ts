#!/usr/bin/env node
/**
 * Buglasan Live Operations — Simple Source Updating
 *
 * Usage:
 *   npm run buglasan:update
 *     (Non-mutating preview of local corpus bundles against production state)
 *
 *   npm run buglasan:update -- --confirm-production
 *     (Explicitly confirms production intake of approved new/changed sources)
 *
 *   npm run buglasan:update -- --reanalyze all|3,7,36 [--confirm-production]
 *     (Deliberately re-processes known bundles with local media analysis; the
 *      collector upserts by post identity, so this can never duplicate a source)
 */
import process from 'node:process'
import { resolve } from 'node:path'
import { createWorker, type Worker } from 'tesseract.js'
import localEnglishData from '@tesseract.js-data/eng'
import { createOfflineTesseractImageProvider, type MediaAnalysisProvider } from '../src/ingestion/sourceInbox.ts'
import { loadEnvLocal } from './phase10-status.ts'
import {
  scanSourceBundles,
  fetchDurableSources,
  compareCorpus,
  formatPreviewReport,
  executeIntake,
  formatStatusReport,
  selectReanalyzeCandidates,
  DEFAULT_SOURCE_ROOT,
} from '../src/operations/updateWorkflow.ts'

async function main(): Promise<void> {
  loadEnvLocal()

  const args = process.argv.slice(2)
  const confirmProduction = args.includes('--confirm-production')
  const jsonOutput = args.includes('--json')

  // Parse optional --source-root
  const rootIndex = args.indexOf('--source-root')
  const sourceRoot = rootIndex !== -1 && args[rootIndex + 1] ? args[rootIndex + 1] : DEFAULT_SOURCE_ROOT

  // Parse optional --reanalyze all|<comma-separated bundle ids>
  const reanalyzeIndex = args.indexOf('--reanalyze')
  let reanalyzeBundles: readonly string[] | 'all' | undefined
  if (reanalyzeIndex !== -1) {
    const value = args[reanalyzeIndex + 1] ?? ''
    if (value === 'all') reanalyzeBundles = 'all'
    else {
      const ids = value.split(',').map((id) => id.trim()).filter((id) => id !== '')
      if (ids.length === 0) throw new Error('--reanalyze requires "all" or a comma-separated list of bundle ids')
      reanalyzeBundles = ids
    }
  }

  // 1. SCAN
  const bundles = await scanSourceBundles({ sourceRoot })

  // 2. COMPARE
  const durableSources = await fetchDurableSources()
  const comparison = compareCorpus(bundles, durableSources)

  // 3. PREVIEW ONLY (Default Behavior)
  if (!confirmProduction) {
    const reanalysis = selectReanalyzeCandidates(comparison.unchanged, reanalyzeBundles)
    if (jsonOutput) {
      console.log(JSON.stringify({
        status: 'preview_only',
        bundles_scanned: comparison.totalBundles,
        unchanged: comparison.unchanged.length,
        new: comparison.newSources.length,
        changed: comparison.changedSources.length,
        needs_identity_review: comparison.needsIdentityReview.length,
        needs_content_review: comparison.needsReview.length,
        incomplete: comparison.incomplete.length,
        invalid: comparison.invalid.length,
        proposed_reanalysis: reanalysis.map((b) => ({
          bundle_id: b.bundleId,
          post_id: b.identity.postId,
          canonical_url: b.identity.canonicalUrl,
        })),
        proposed_intake: comparison.newSources.map((b) => ({
          bundle_id: b.bundleId,
          post_id: b.identity.postId,
          canonical_url: b.identity.canonicalUrl,
        })),
        needs_identity_review_details: comparison.needsIdentityReview.map((b) => ({
          bundle_id: b.bundleId,
          raw_url: b.rawUrl,
          reason: b.identity.reason,
        })),
        needs_content_review_details: comparison.needsReview.map((b) => ({
          bundle_id: b.bundleId,
          post_id: b.identity.postId,
          canonical_url: b.identity.canonicalUrl,
          reason: b.classificationReason,
        })),
      }, null, 2))
    } else {
      console.log(formatPreviewReport(comparison))
      if (reanalysis.length > 0) {
        console.log('--- Proposed Re-analysis (known sources, same identity) ---')
        for (const b of reanalysis) console.log(`~ Bundle ${b.bundleId} [${b.identity.postId}] (${b.media.length} media file(s)) — re-processed with local media analysis; unchanged content is an idempotent no-op`)
        console.log('')
      }
    }
    return
  }

  // 4. INTAKE (Explicit Confirmation Required)
  // Provision the checked-in offline Tesseract runtime so image-derived schedule
  // text reaches source knowledge. No secrets and no network are involved; if the
  // local runtime cannot start, the established deterministic-local provider keeps
  // prior behavior and the gap is reported loudly instead of silently.
  const intakeComparison = comparison
  const needsMediaAnalysis = [...intakeComparison.newSources, ...intakeComparison.changedSources, ...selectReanalyzeCandidates(intakeComparison.unchanged, reanalyzeBundles)].some((b) => b.media.some((m) => m.kind === 'image'))
  let worker: Worker | null = null
  let imageProvider: MediaAnalysisProvider | undefined
  if (needsMediaAnalysis) {
    try {
      const langPath = process.env.SOURCE_INBOX_TESSDATA_PATH ?? localEnglishData.langPath
      worker = await createWorker('eng', 1, {
        langPath: resolve(langPath),
        cacheMethod: 'none',
        ...(process.env.SOURCE_INBOX_TESSERACT_WORKER_PATH ? { workerPath: process.env.SOURCE_INBOX_TESSERACT_WORKER_PATH } : {}),
        ...(process.env.SOURCE_INBOX_TESSERACT_CORE_PATH ? { corePath: process.env.SOURCE_INBOX_TESSERACT_CORE_PATH } : {}),
      })
      imageProvider = createOfflineTesseractImageProvider({ recognize: async (bytes) => worker!.recognize(Buffer.from(bytes)) })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      console.error(`OCR_RUNTIME_UNAVAILABLE: local Tesseract runtime could not start (${message}); continuing with the deterministic-local provider, so image text will not be captured for this run.`)
      worker = null
      imageProvider = undefined
    }
  }

  let result
  try {
    result = await executeIntake(intakeComparison, {
      confirmProduction: true,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
      indexingToken: process.env.INDEX_SOURCE_TOKEN,
      extractionToken: process.env.EXTRACT_SOURCE_TOKEN,
      reconciliationToken: process.env.RECONCILE_EVENT_TOKEN,
      ...(imageProvider ? { imageProvider } : {}),
      ...(reanalyzeBundles ? { reanalyzeBundles } : {}),
    })
  } finally {
    await worker?.terminate()
  }

  if (jsonOutput) {
    console.log(JSON.stringify({
      status: result.status,
      admitted_count: result.admitted.length,
      admitted: result.admitted,
      downstream: result.downstreamReport,
      comparison: {
        total: comparison.totalBundles,
        unchanged: comparison.unchanged.length,
        new: comparison.newSources.length,
        changed: comparison.changedSources.length,
        needs_review: comparison.needsIdentityReview.length,
        needs_content_review: comparison.needsReview.length,
        reanalyzed: selectReanalyzeCandidates(comparison.unchanged, reanalyzeBundles).length,
      },
    }, null, 2))
  } else {
    console.log(formatStatusReport(result))
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown error during Buglasan update'
  console.error(`BUGLASAN_UPDATE_FAILED: ${message}`)
  process.exit(1)
})
