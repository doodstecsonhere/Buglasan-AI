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
 */
import process from 'node:process'
import { loadEnvLocal } from './phase10-status.ts'
import {
  scanSourceBundles,
  fetchDurableSources,
  compareCorpus,
  formatPreviewReport,
  executeIntake,
  formatStatusReport,
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

  // 1. SCAN
  const bundles = await scanSourceBundles({ sourceRoot })

  // 2. COMPARE
  const durableSources = await fetchDurableSources()
  const comparison = compareCorpus(bundles, durableSources)

  // 3. PREVIEW ONLY (Default Behavior)
  if (!confirmProduction) {
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
        proposed_intake: comparison.newSources.map((b) => ({
          bundle_id: b.bundleId,
          post_id: b.identity.postId,
          canonical_url: b.identity.canonicalUrl,
        })),
        needs_review: comparison.needsIdentityReview.map((b) => ({
          bundle_id: b.bundleId,
          raw_url: b.rawUrl,
          reason: b.identity.reason,
        })),
        needs_content_review: comparison.needsReview.map((b) => ({
          bundle_id: b.bundleId,
          post_id: b.identity.postId,
          canonical_url: b.identity.canonicalUrl,
          reason: b.classificationReason,
        })),
      }, null, 2))
    } else {
      console.log(formatPreviewReport(comparison))
    }
    return
  }

  // 4. INTAKE (Explicit Confirmation Required)
  const result = await executeIntake(comparison, {
    confirmProduction: true,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
    indexingToken: process.env.INDEX_SOURCE_TOKEN,
    extractionToken: process.env.EXTRACT_SOURCE_TOKEN,
    reconciliationToken: process.env.RECONCILE_EVENT_TOKEN,
  })

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
