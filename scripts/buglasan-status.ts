#!/usr/bin/env node
/**
 * Buglasan Live Operations — Read-Only Corpus & Pipeline Status Summary
 *
 * Usage:
 *   npm run buglasan:status
 */
import process from 'node:process'
import { loadEnvLocal, summarize, fetchStatus } from './phase10-status.ts'
import {
  scanSourceBundles,
  fetchDurableSources,
  compareCorpus,
  DEFAULT_SOURCE_ROOT,
} from '../src/operations/updateWorkflow.ts'

async function main(): Promise<void> {
  loadEnvLocal()

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY

  // 1. Scan Local Authoritative Corpus
  const bundles = await scanSourceBundles({ sourceRoot: DEFAULT_SOURCE_ROOT, loadMediaBytes: false })
  const durableSources = await fetchDurableSources(url, key)
  const comparison = compareCorpus(bundles, durableSources)

  console.log('==================================================')
  console.log('Buglasan Live Operations Status (Read-Only)')
  console.log('==================================================')
  console.log('')
  console.log('Local Authoritative Corpus:')
  console.log(`  Source directory:        ${DEFAULT_SOURCE_ROOT}`)
  console.log(`  Local bundles found:     ${comparison.totalBundles}`)
  console.log(`  Already known / current: ${comparison.unchanged.length}`)
  console.log(`  New pending intake:      ${comparison.newSources.length}`)
  console.log(`  Changed pending review:  ${comparison.changedSources.length}`)
  console.log(`  Needs identity review:   ${comparison.needsIdentityReview.length}`)
  if (comparison.needsIdentityReview.length > 0) {
    console.log(`  Bundles needing review:  ${comparison.needsIdentityReview.map((b) => b.bundleId).join(', ')}`)
  }
  console.log('')

  // 2. Production Pipeline Status (if configured)
  if (url && key) {
    try {
      const statusRows = await fetchStatus(url, key)
      const summary = summarize(statusRows)
      console.log('Production Corpus & Pipeline:')
      console.log(`  Total sources in DB:     ${summary.sources}`)
      console.log(`  Source status:           ${JSON.stringify(summary.source_status)}`)
      console.log(`  Indexing status:         ${JSON.stringify(summary.indexing_status)}`)
      console.log(`  Extraction status:       ${JSON.stringify(summary.extraction_status)}`)
    } catch (e) {
      console.log(`  (Could not fetch production pipeline status: ${e instanceof Error ? e.message : 'connection failed'})`)
    }
  } else {
    console.log('Production Corpus: (SUPABASE_URL/KEY not configured in environment)')
  }

  console.log('')
  console.log('==================================================')
  if (comparison.newSources.length > 0 || comparison.changedSources.length > 0) {
    console.log('Updates available! To preview proposed updates, run:')
    console.log('  npm run buglasan:update')
  } else {
    console.log('Corpus is up to date.')
  }
  console.log('==================================================')
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown status failure'
  console.error(`BUGLASAN_STATUS_FAILED: ${message}`)
  process.exit(1)
})
