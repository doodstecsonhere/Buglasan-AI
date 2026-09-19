/**
 * Image Knowledge Acceptance — local, read-only, no production mutation
 *
 * Proves that the checked-in offline Tesseract runtime turns the text inside an
 * authoritative source bundle's images into provenance-labelled source knowledge
 * that reaches the approved ingress text. It reuses the exact production code paths
 * (scanSourceBundles -> analyzeSourceInbox -> approveSourceInboxPreview) so the
 * evidence reflects shipped behaviour, not a parallel implementation.
 *
 * Nothing here is specific to any one bundle: no event names, dates, filenames, or
 * image counts are hard-coded. Generic regexes only classify whether extracted text
 * looks schedule-bearing so the operator can eyeball the result.
 *
 * Usage:
 *   npm run image-knowledge:acceptance -- --bundle 36
 *   npm run image-knowledge:acceptance -- --bundle 36 --source-root "operator-sources/Buglasan 2026 Official Sources" [--json]
 *
 * Exit code is non-zero when the local OCR runtime produced no image text at all,
 * or when any accepted image is unaccounted for, so it is safe to use as a gate.
 */
import { existsSync } from 'node:fs'
import process from 'node:process'
import { resolve } from 'node:path'
import { createWorker } from 'tesseract.js'
import localEnglishData from '@tesseract.js-data/eng'
import {
  analyzeSourceInbox,
  approveSourceInboxPreview,
  createOfflineTesseractImageProvider,
  type ImageAnalysisResult,
  type SourceInboxImage,
} from '../src/ingestion/sourceInbox.ts'
import { scanSourceBundles, DEFAULT_SOURCE_ROOT } from '../src/operations/updateWorkflow.ts'

function option(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

/** Generic, content-agnostic signals that a snippet looks like schedule text. */
const SCHEDULE_SIGNAL_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'time', re: /\b\d{1,2}\s?(?:AM|PM)\b/i },
  { label: 'day-of-week', re: /\b(?:MON|TUE|WED|THU|FRI|SAT|SUN)(?:DAY)?\b/i },
  { label: 'month', re: /\b(?:JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\b/i },
  { label: 'numeric-date', re: /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/ },
]

function scheduleSignals(text: string): string[] {
  return SCHEDULE_SIGNAL_PATTERNS.filter(({ re }) => re.test(text)).map(({ label }) => label)
}

function snippet(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`
}

interface PerImageReport {
  ordinal: number
  name: string
  sha256: string
  text_state: string
  failure: string | null
  char_count: number
  schedule_signals: string[]
  snippet: string
}

function reportForImage(index: number, analysis: ImageAnalysisResult, name: string): PerImageReport {
  const text = analysis.ocr_text ?? ''
  return {
    ordinal: index + 1,
    name,
    sha256: analysis.image_sha256.slice(0, 12),
    text_state: analysis.text_state,
    failure: analysis.failure,
    char_count: text.length,
    schedule_signals: text === '' ? [] : scheduleSignals(text),
    snippet: text === '' ? '' : snippet(text),
  }
}

async function main(): Promise<void> {
  const bundleId = option('--bundle')
  const sourceRoot = option('--source-root') ?? DEFAULT_SOURCE_ROOT
  const asJson = process.argv.includes('--json')
  if (bundleId === null) throw new Error('Usage: npm run image-knowledge:acceptance -- --bundle <id> [--source-root <dir>] [--json]')

  const absoluteRoot = resolve(sourceRoot)
  if (!existsSync(absoluteRoot)) {
    // operator-sources/ is intentionally gitignored, so a missing directory is an
    // environment gap rather than a code failure. Report it loudly and stop.
    throw new Error(`Source root not found: ${absoluteRoot}\nThis local corpus is gitignored; place the authoritative bundles there (or pass --source-root) before running acceptance.`)
  }

  const bundles = await scanSourceBundles({ sourceRoot: absoluteRoot })
  const bundle = bundles.find((b) => b.bundleId === bundleId)
  if (bundle === undefined) {
    throw new Error(`Bundle "${bundleId}" not found under ${absoluteRoot}. Scanned ${bundles.length} bundle(s): ${bundles.map((b) => b.bundleId).join(', ')}`)
  }
  if (bundle.identity.status !== 'resolved' || !bundle.identity.canonicalUrl) {
    throw new Error(`Bundle "${bundleId}" has no resolved canonical identity, cannot run acceptance: ${bundle.identity.reason ?? 'unknown'}`)
  }
  const images = bundle.media.filter((m) => m.kind === 'image' && m.mimeType && m.bytes)
  if (images.length === 0) throw new Error(`Bundle "${bundleId}" contains no image media to process.`)

  const langPath = process.env.SOURCE_INBOX_TESSDATA_PATH ?? localEnglishData.langPath
  const localWorkerPath = process.env.SOURCE_INBOX_TESSERACT_WORKER_PATH
  const localCorePath = process.env.SOURCE_INBOX_TESSERACT_CORE_PATH
  const worker = await createWorker('eng', 1, {
    langPath: resolve(langPath),
    cacheMethod: 'none',
    ...(localWorkerPath ? { workerPath: localWorkerPath } : {}),
    ...(localCorePath ? { corePath: localCorePath } : {}),
  })

  try {
    const inboxImages: SourceInboxImage[] = images.map((m) => ({ name: m.name, mimeType: m.mimeType!, bytes: m.bytes! }))
    const imageProvider = createOfflineTesseractImageProvider({ recognize: async (bytes) => worker.recognize(Buffer.from(bytes)) })

    const preview = await analyzeSourceInbox({
      facebookPostUrl: bundle.identity.canonicalUrl,
      operatorCaption: bundle.caption,
      images: inboxImages,
      videos: [],
      collectedAt: new Date().toISOString(),
      festivalYear: null,
    }, imageProvider)

    // Every accepted image must have exactly one analysis row (1:1, order preserved).
    if (preview.analyses.length !== preview.image_evidence.length) {
      throw new Error(`Analysis/evidence count mismatch: ${preview.analyses.length} analyses vs ${preview.image_evidence.length} accepted images.`)
    }
    const perImage = preview.analyses.map((analysis, index) => reportForImage(index, analysis, preview.image_evidence[index].name))
    const imagesWithText = perImage.filter((row) => row.text_state === 'text' && row.char_count > 0)
    const imagesFailed = perImage.filter((row) => row.failure !== null)

    const payload = approveSourceInboxPreview(preview, (p) => p, { confirmOcrReview: true })
    const combinedText = payload.raw_text ?? ''
    const sectionHeaders = combinedText.match(/\[IMAGE \d+ \u2014 [^\]]+ OCR\]/g) ?? []

    // Prove the first, a middle, and the final contributing image each add a section.
    const ordinalsInText = sectionHeaders.map((header) => Number(/\[IMAGE (\d+)/.exec(header)![1]))
    const contributingOrdinals = perImage.filter((row) => row.text_state === 'text' && row.char_count > 0).map((row) => row.ordinal)
    const missingContributors = contributingOrdinals.filter((ordinal) => !ordinalsInText.includes(ordinal))

    const passed = imagesFailed.length === 0 && imagesWithText.length > 0 && missingContributors.length === 0 && sectionHeaders.length === imagesWithText.length

    if (asJson) {
      process.stdout.write(`${JSON.stringify({
        bundle_id: bundle.bundleId,
        post_id: bundle.identity.postId,
        canonical_url: bundle.identity.canonicalUrl,
        caption_char_count: bundle.caption?.length ?? 0,
        images_found: images.length,
        images_accepted: preview.image_evidence.length,
        images_with_text: imagesWithText.length,
        images_no_text: perImage.filter((row) => row.text_state !== 'text' && row.failure === null).length,
        images_failed: imagesFailed.length,
        combined_ingress_char_count: combinedText.length,
        image_sections_in_text: sectionHeaders.length,
        contributing_ordinals: contributingOrdinals,
        ordinals_present_in_text: ordinalsInText,
        missing_contributors: missingContributors,
        acceptance: passed ? 'PASS' : 'FAIL',
        per_image: perImage,
      }, null, 2)}\n`)
    } else {
      const lines: string[] = [
        '==================================================',
        `Image Knowledge Acceptance — Bundle ${bundle.bundleId}`,
        '==================================================',
        `Identity:        ${bundle.identity.canonicalUrl}`,
        `Caption chars:   ${bundle.caption?.length ?? 0}`,
        `Images found:    ${images.length} (accepted ${preview.image_evidence.length})`,
        `Images w/ text:  ${imagesWithText.length}`,
        `Images no text:  ${perImage.filter((row) => row.text_state !== 'text' && row.failure === null).length}`,
        `Images failed:   ${imagesFailed.length}`,
        `Combined ingress text chars: ${combinedText.length}`,
        `Provenance image sections in text: ${sectionHeaders.length}`,
        `Contributing ordinals: ${contributingOrdinals.join(', ') || '(none)'}`,
        '',
        '--- Per-image report ---',
      ]
      for (const row of perImage) {
        lines.push(`#${String(row.ordinal).padStart(2, ' ')} ${row.name} [${row.sha256}] state=${row.text_state}${row.failure ? ` failure="${row.failure}"` : ''} chars=${row.char_count}${row.schedule_signals.length ? ` signals=${row.schedule_signals.join('/')}` : ''}`)
        if (row.snippet) lines.push(`     ${row.snippet}`)
      }
      lines.push('')
      lines.push('==================================================')
      lines.push(passed ? `ACCEPTANCE: PASS — ${imagesWithText.length} image(s) contributed provenance-labelled text; early/middle/final ordinals all present.` : 'ACCEPTANCE: FAIL — see counts above (no image text reached ingress, or a contributor is missing, or an image failed).')
      lines.push('==================================================')
      process.stdout.write(`${lines.join('\n')}\n`)
    }

    if (!passed) {
      // Reading the bundle back is only meaningful if the local runtime produced text;
      // treat a silent zero-text run (typically a missing OCR runtime) as a hard failure.
      throw new Error(`Acceptance failed for bundle ${bundle.bundleId}: images_with_text=${imagesWithText.length}, failed=${imagesFailed.length}, missing_contributors=${missingContributors.join(',') || 'none'}`)
    }
  } finally {
    await worker.terminate()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
