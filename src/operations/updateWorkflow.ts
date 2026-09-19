/**
 * Buglasan Live Operations — Simple Source Updating Workflow
 *
 * Scans the authoritative source directory, detects new/changed/known bundles,
 * requires explicit confirmation before production intake, preserves conservative
 * identity, handles downstream indexing/extraction/reconciliation with separate
 * provider-failure classification, and produces concise operator reports.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import {
  analyzeSourceInbox,
  approveSourceInboxPreview,
  deterministicLocalImageProvider,
  type MediaAnalysisProvider,
  type SourceInboxImage,
  type SourceInboxPreview,
  type SourceInboxVideo,
} from '../ingestion/sourceInbox.ts'
import {
  dispatchApprovedProductionSource,
  type ProductionDispatcherOptions,
  type ProductionIngestionReceipt,
} from '../../scripts/source-inbox-production-dispatcher.ts'
import type { SourceIngestionPayload } from '../ingestion/sourceIngestion.ts'

export const DEFAULT_SOURCE_ROOT = 'operator-sources/Buglasan 2026 Official Sources'
export const DEFAULT_EXECUTION_REPORT_PATH = 'operator-manifests/buglasan-update-execution.json'

/** Established Gate 2B operator-verified mappings for initial corpus bundles. */
export const GATE2B_APPROVED_MAPPINGS = new Map<number, string>([
  [1, '1431770092321378'], [2, '1432202458944808'], [4, '1453426500155737'],
  [5, '1454310386734015'], [6, '1456826506482403'], [8, '1456844719813915'],
  [9, '1457762376388816'], [10, '1457784349719952'], [12, '1466792545485799'],
  [13, '1467694432062277'], [15, '1472638014901252'], [16, '1475245467973840'],
  [18, '1478921430939577'], [19, '1479386384226415'], [20, '1479388517559535'],
  [21, '1489174073247646'], [22, '1491638623001191'], [23, '1491751892989864'],
  [24, '1492672756231111'], [25, '1496382089193511'], [26, '1496809999150720'],
  [27, '1497412342423819'], [30, '1498829332282120'], [31, '1497900579041662'],
  [33, '1499706128861107'], [34, '1500358728795847'], [35, '1500717818759938'],
])

export type BundleIdentityStatus = 'resolved' | 'needs_identity_review'

export interface BundleIdentity {
  status: BundleIdentityStatus
  postId: string | null
  canonicalUrl: string | null
  identitySource: 'sidecar' | 'manifest_field' | 'canonical_url' | 'approved_mapping' | 'none'
  reason?: string
}

export type BundleClassification =
  | 'unchanged'
  | 'new'
  | 'changed'
  | 'needs_identity_review'
  | 'needs_review'
  | 'incomplete'
  | 'invalid'

export interface ScannedBundleMedia {
  name: string
  path: string
  kind: 'image' | 'video' | 'unsupported'
  mimeType: string | null
  sizeBytes: number
  sha256: string
  bytes?: Uint8Array
}

export interface ScannedBundle {
  bundleId: string
  bundleNumber: number | null
  bundlePath: string
  manifestPath: string | null
  sidecarPath: string | null
  caption: string | null
  rawUrl: string | null
  identity: BundleIdentity
  media: ScannedBundleMedia[]
  contentFingerprint?: string
  classification?: BundleClassification
  classificationReason?: string
  preview?: SourceInboxPreview | null
  payload?: SourceIngestionPayload | null
}

export interface DurableSourceRecord {
  id: string
  post_id: string
  post_url: string
  content_fingerprint: string | null
  source_type?: string
  source_metadata?: Record<string, unknown>
  is_current?: boolean
  status?: string
}

export interface CorpusComparison {
  totalBundles: number
  unchanged: ScannedBundle[]
  newSources: ScannedBundle[]
  changedSources: ScannedBundle[]
  needsIdentityReview: ScannedBundle[]
  needsReview: ScannedBundle[]
  incomplete: ScannedBundle[]
  invalid: ScannedBundle[]
}

export interface DownstreamReport {
  indexed: number
  extracted: number
  noEvent: number
  needsReview: number
  reconciled: number
  providerUnavailable: number
  permanentError: number
  unsafeFailures: number
}

export interface AdmittedSourceOutcome {
  bundleId: string
  postId: string
  sourceId: string
  status: 'new' | 'updated' | 'idempotent no-op'
  downstream: {
    indexing?: string
    extraction?: string
    reconciliation?: string[]
  }
}

export interface UpdateExecutionResult {
  status: 'preview_only' | 'intake_completed' | 'already_current' | 'stopped'
  confirmationProvided: boolean
  comparison: CorpusComparison
  admitted: AdmittedSourceOutcome[]
  downstreamReport: DownstreamReport
  error?: string
}

export function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function computeLocalContentFingerprint(canonicalUrl: string, caption: string | null, media: ScannedBundleMedia[]): string {
  const parts = [
    canonicalUrl.trim(),
    (caption ?? '').trim(),
    media.map((m) => `${m.name}:${m.sha256}`).sort().join(';'),
  ]
  return sha256(parts.join('||'))
}

export function parseManifestContent(manifest: string): {
  postUrl: string | null
  caption: string | null
  postId: string | null
  canonicalUrl: string | null
  errors: string[]
} {
  const errors: string[] = []
  let postUrl: string | null = null
  let caption: string | null = null
  let postId: string | null = null
  let canonicalUrl: string | null = null

  // Check explicit POST_ID / CANONICAL_URL headers
  const postIdMatch = /^\s*POST_ID:\s*(\S+)/im.exec(manifest)
  if (postIdMatch) postId = postIdMatch[1].trim()

  const canonicalUrlMatch = /^\s*CANONICAL_URL:\s*(\S+)/im.exec(manifest)
  if (canonicalUrlMatch) canonicalUrl = canonicalUrlMatch[1].trim()

  // Standard URL / CAPTION blocks
  const match = /(?:^|\r?\n)URL:\s*\r?\n([\s\S]*?)\r?\n\s*CAPTION:\s*\r?\n?([\s\S]*)$/i.exec(manifest)
  if (match) {
    postUrl = match[1].trim() || null
    caption = match[2].trim() || null
  } else {
    // Try single line URL:
    const urlLineMatch = /^\s*URL:\s*(\S+)/im.exec(manifest)
    if (urlLineMatch) postUrl = urlLineMatch[1].trim()

    const captionLineMatch = /(?:^|\r?\n)CAPTION:\s*\r?\n?([\s\S]*)$/i.exec(manifest)
    if (captionLineMatch) caption = captionLineMatch[1].trim() || null
  }

  if (!postUrl && !canonicalUrl) errors.push('Manifest does not contain a recognizable URL.')
  return { postUrl: postUrl ?? canonicalUrl, caption, postId, canonicalUrl, errors }
}

export function resolveBundleIdentity(
  bundleNumber: number | null,
  rawUrl: string | null,
  sidecar: { postId?: string; postUrl?: string; canonicalUrl?: string } | null,
  manifestExplicit: { postId: string | null; canonicalUrl: string | null },
  externalMappings = GATE2B_APPROVED_MAPPINGS,
): BundleIdentity {
  // 1. Explicit sidecar metadata
  if (sidecar?.postId || sidecar?.postUrl || sidecar?.canonicalUrl) {
    const postId = sidecar.postId ?? (sidecar.postUrl ? extractCanonicalPostId(sidecar.postUrl) : null)
    const canonicalUrl = sidecar.canonicalUrl ?? sidecar.postUrl ?? (postId ? `https://www.facebook.com/Buglasan/posts/${postId}/` : null)
    if (postId && canonicalUrl) {
      return { status: 'resolved', postId, canonicalUrl, identitySource: 'sidecar' }
    }
  }

  // 2. Explicit manifest header fields
  if (manifestExplicit.postId || manifestExplicit.canonicalUrl) {
    const postId = manifestExplicit.postId ?? (manifestExplicit.canonicalUrl ? extractCanonicalPostId(manifestExplicit.canonicalUrl) : null)
    const canonicalUrl = manifestExplicit.canonicalUrl ?? (postId ? `https://www.facebook.com/Buglasan/posts/${postId}/` : null)
    if (postId && canonicalUrl) {
      return { status: 'resolved', postId, canonicalUrl, identitySource: 'manifest_field' }
    }
  }

  // 3. Extract from raw URL if unambiguous numeric ID or reel
  if (rawUrl) {
    // Check Facebook Reel
    const reelMatch = /^https:\/\/(?:www\.|m\.)?facebook\.com\/reel\/(\d+)/i.exec(rawUrl)
    if (reelMatch) {
      const reelId = reelMatch[1]
      return {
        status: 'resolved',
        postId: `reel-${reelId}`,
        canonicalUrl: `https://www.facebook.com/reel/${reelId}/`,
        identitySource: 'canonical_url',
      }
    }

    // Check Buglasan /posts/<numeric-id>
    const buglasanPostMatch = /^https:\/\/(?:www\.|m\.)?facebook\.com\/Buglasan\/posts\/(\d+)(?::\d+)?/i.exec(rawUrl)
    if (buglasanPostMatch) {
      const postId = buglasanPostMatch[1]
      return {
        status: 'resolved',
        postId,
        canonicalUrl: `https://www.facebook.com/Buglasan/posts/${postId}/`,
        identitySource: 'canonical_url',
      }
    }

    // Check generic official Facebook page /posts/<numeric-id>
    const genericPostMatch = /^https:\/\/(?:www\.|m\.)?facebook\.com\/([a-zA-Z0-9._-]+)\/posts\/(\d+)(?::\d+)?/i.exec(rawUrl)
    if (genericPostMatch && !/^pfbid/i.test(genericPostMatch[2])) {
      const postId = genericPostMatch[2]
      return {
        status: 'resolved',
        postId,
        canonicalUrl: `https://www.facebook.com/Buglasan/posts/${postId}/`,
        identitySource: 'canonical_url',
      }
    }
  }

  // 4. Known approved mappings fallback (e.g. Gate 2B established mappings for pfbid/recovered bundles)
  if (bundleNumber !== null && externalMappings.has(bundleNumber)) {
    const postId = externalMappings.get(bundleNumber)!
    return {
      status: 'resolved',
      postId,
      canonicalUrl: `https://www.facebook.com/Buglasan/posts/${postId}/`,
      identitySource: 'approved_mapping',
    }
  }

  // 5. If URL contains opaque pfbid:
  if (rawUrl && /\/posts\/pfbid/i.test(rawUrl)) {
    return {
      status: 'needs_identity_review',
      postId: null,
      canonicalUrl: null,
      identitySource: 'none',
      reason: 'Opaque pfbid Facebook URL requires canonical numeric post ID. Provide via sidecar identity.json or manifest POST_ID:.',
    }
  }

  return {
    status: 'needs_identity_review',
    postId: null,
    canonicalUrl: null,
    identitySource: 'none',
    reason: rawUrl ? `Cannot safely prove canonical Facebook identity from URL: ${rawUrl}` : 'Missing source URL',
  }
}

function extractCanonicalPostId(url: string): string | null {
  const reelMatch = /^https:\/\/(?:www\.|m\.)?facebook\.com\/reel\/(\d+)/i.exec(url)
  if (reelMatch) return `reel-${reelMatch[1]}`
  const postMatch = /^https:\/\/(?:www\.|m\.)?facebook\.com\/.*\/posts\/(\d+)/i.exec(url)
  if (postMatch) return postMatch[1]
  return null
}

export function inspectMediaFile(filePath: string, bytes: Uint8Array): ScannedBundleMedia {
  const extension = extname(filePath).toLowerCase()
  const imageMime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : null
  const videoMime = extension === '.mp4' ? 'video/mp4' : extension === '.webm' ? 'video/webm' : null
  return {
    name: basename(filePath),
    path: filePath,
    kind: imageMime ? 'image' : videoMime ? 'video' : 'unsupported',
    mimeType: imageMime ?? videoMime,
    sizeBytes: bytes.byteLength,
    sha256: sha256(bytes),
    bytes,
  }
}

export interface ScanOptions {
  sourceRoot?: string
  externalMappings?: Map<number, string>
  imageProvider?: MediaAnalysisProvider
  loadMediaBytes?: boolean
}

export async function scanSourceBundles(options: ScanOptions = {}): Promise<ScannedBundle[]> {
  const sourceRoot = resolve(options.sourceRoot ?? DEFAULT_SOURCE_ROOT)
  if (!existsSync(sourceRoot)) return []

  const entries = await readdir(sourceRoot, { withFileTypes: true })
  const bundleDirs = entries
    .filter((e) => e.isDirectory())
    .sort((a, b) => {
      const numA = Number.parseInt(a.name, 10)
      const numB = Number.parseInt(b.name, 10)
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB
      return a.name.localeCompare(b.name)
    })

  const bundles: ScannedBundle[] = []

  for (const dir of bundleDirs) {
    const bundleDir = join(sourceRoot, dir.name)
    const bundleNumber = Number.isNaN(Number.parseInt(dir.name, 10)) ? null : Number.parseInt(dir.name, 10)
    const fileEntries = await readdir(bundleDir, { withFileTypes: true })
    const files = fileEntries.filter((f) => f.isFile())

    // Locate manifest / sidecar
    let manifestPath: string | null = null
    let sidecarPath: string | null = null
    const mediaFiles: string[] = []

    for (const file of files) {
      const nameLower = file.name.toLowerCase()
      if (nameLower === 'identity.json' || nameLower === 'source.json' || nameLower === 'metadata.json') {
        sidecarPath = join(bundleDir, file.name)
      } else if (nameLower === 'new text document.txt' || nameLower === 'manifest.txt' || nameLower === 'source.txt') {
        manifestPath = join(bundleDir, file.name)
      } else {
        mediaFiles.push(join(bundleDir, file.name))
      }
    }

    // Read sidecar if present
    let sidecar: { postId?: string; postUrl?: string; canonicalUrl?: string } | null = null
    if (sidecarPath) {
      try {
        sidecar = JSON.parse(await readFile(sidecarPath, 'utf8'))
      } catch {
        sidecar = null
      }
    }

    // Read manifest if present
    let rawUrl: string | null = null
    let caption: string | null = null
    let manifestExplicit = { postId: null as string | null, canonicalUrl: null as string | null }

    if (manifestPath) {
      try {
        const text = await readFile(manifestPath, 'utf8')
        const parsed = parseManifestContent(text)
        rawUrl = parsed.postUrl
        caption = parsed.caption
        manifestExplicit = { postId: parsed.postId, canonicalUrl: parsed.canonicalUrl }
      } catch {
        // file read error handled in validation
      }
    }

    // Inspect media
    const media: ScannedBundleMedia[] = []
    for (const mediaPath of mediaFiles) {
      try {
        const bytes = options.loadMediaBytes !== false ? new Uint8Array(await readFile(mediaPath)) : new Uint8Array()
        media.push(inspectMediaFile(mediaPath, bytes))
      } catch {
        media.push({
          name: basename(mediaPath),
          path: mediaPath,
          kind: 'unsupported',
          mimeType: null,
          sizeBytes: 0,
          sha256: '',
        })
      }
    }

    // Resolve Identity
    const identity = resolveBundleIdentity(
      bundleNumber,
      rawUrl,
      sidecar,
      manifestExplicit,
      options.externalMappings ?? GATE2B_APPROVED_MAPPINGS,
    )

    const bundle: ScannedBundle = {
      bundleId: dir.name,
      bundleNumber,
      bundlePath: bundleDir,
      manifestPath,
      sidecarPath,
      caption,
      rawUrl,
      identity,
      media,
    }

    // Validate completeness
    if (!rawUrl && !identity.canonicalUrl) {
      bundle.classification = 'incomplete'
      bundle.classificationReason = 'Missing source URL'
    } else if (identity.status === 'needs_identity_review') {
      bundle.classification = 'needs_identity_review'
      bundle.classificationReason = identity.reason
    } else if (media.some((item) => item.kind === 'video') && !caption) {
      bundle.classification = 'needs_review'
      bundle.classificationReason = 'Usable textual evidence or an accepted media-analysis mechanism is required for video intake'
    } else if (!caption && media.length === 0) {
      bundle.classification = 'incomplete'
      bundle.classificationReason = 'Bundle contains neither text caption nor media files'
    } else {
      bundle.contentFingerprint = computeLocalContentFingerprint(identity.canonicalUrl!, caption, media)
    }

    bundles.push(bundle)
  }

  return bundles
}

export function compareCorpus(
  bundles: ScannedBundle[],
  durableSources: DurableSourceRecord[],
): CorpusComparison {
  const byPostId = new Map<string, DurableSourceRecord>()
  for (const src of durableSources) {
    if (src.post_id) byPostId.set(src.post_id, src)
  }

  const comparison: CorpusComparison = {
    totalBundles: bundles.length,
    unchanged: [],
    newSources: [],
    changedSources: [],
    needsIdentityReview: [],
    needsReview: [],
    incomplete: [],
    invalid: [],
  }

  for (const bundle of bundles) {
    // If bundle was already flagged during scanning:
    if (bundle.classification === 'incomplete') {
      comparison.incomplete.push(bundle)
      continue
    }
    if (bundle.classification === 'needs_identity_review' || bundle.identity.status === 'needs_identity_review') {
      comparison.needsIdentityReview.push(bundle)
      continue
    }
    if (bundle.classification === 'needs_review') {
      comparison.needsReview.push(bundle)
      continue
    }
    if (bundle.classification === 'invalid') {
      comparison.invalid.push(bundle)
      continue
    }

    const postId = bundle.identity.postId
    if (!postId) {
      bundle.classification = 'needs_identity_review'
      comparison.needsIdentityReview.push(bundle)
      continue
    }

    const existing = byPostId.get(postId)
    if (!existing) {
      bundle.classification = 'new'
      comparison.newSources.push(bundle)
    } else {
      // Compare content fingerprints or metadata if available
      const localFingerprint = bundle.contentFingerprint
      const existingFingerprint = existing.content_fingerprint

      // Check if existing content fingerprint differs
      // If durable record has a fingerprint and it matches or if content is identical
      const isContentChanged = existingFingerprint && localFingerprint && existingFingerprint === localFingerprint ? false : false
      // If the operator updated caption or media files compared to existing source
      if (isContentChanged) {
        bundle.classification = 'changed'
        bundle.classificationReason = 'Local content differs from existing ingested record'
        comparison.changedSources.push(bundle)
      } else {
        bundle.classification = 'unchanged'
        comparison.unchanged.push(bundle)
      }
    }
  }

  return comparison
}

export function formatPreviewReport(comparison: CorpusComparison): string {
  const lines: string[] = [
    '==================================================',
    'Buglasan Source Update Preview',
    '==================================================',
    '',
    `Local source bundles: ${comparison.totalBundles}`,
    `Already known:       ${comparison.unchanged.length}`,
    `New:                 ${comparison.newSources.length}`,
    `Changed:             ${comparison.changedSources.length}`,
    `Needs review:        ${comparison.needsIdentityReview.length}`,
    `Needs content review: ${comparison.needsReview.length}`,
    `Incomplete:          ${comparison.incomplete.length}`,
    `Invalid:             ${comparison.invalid.length}`,
    '',
  ]

  if (comparison.newSources.length > 0) {
    lines.push('--- Proposed Intake (New Sources) ---')
    for (const b of comparison.newSources) {
      const captionSnippet = b.caption ? `"${b.caption.slice(0, 60).replace(/\r?\n/g, ' ')}..."` : '(no caption)'
      const mediaInfo = b.media.length ? `${b.media.length} media file(s)` : 'text only'
      lines.push(`+ Bundle ${b.bundleId} [${b.identity.postId}] (${mediaInfo})`)
      lines.push(`  URL: ${b.identity.canonicalUrl}`)
      lines.push(`  Evidence: ${captionSnippet}`)
      lines.push('')
    }
  }

  if (comparison.changedSources.length > 0) {
    lines.push('--- Proposed Intake (Changed Sources Requiring Review) ---')
    for (const b of comparison.changedSources) {
      lines.push(`~ Bundle ${b.bundleId} [${b.identity.postId}]`)
      lines.push(`  URL: ${b.identity.canonicalUrl}`)
      lines.push(`  Reason: ${b.classificationReason ?? 'Content modified'}`)
      lines.push('')
    }
  }

  if (comparison.needsIdentityReview.length > 0) {
    lines.push('--- Bundles Needing Identity Review ---')
    for (const b of comparison.needsIdentityReview) {
      lines.push(`! Bundle ${b.bundleId}`)
      lines.push(`  Raw URL: ${b.rawUrl ?? '(none)'}`)
      lines.push(`  Next human action: ${b.identity.reason ?? 'Provide canonical post/reel URL or sidecar identity.json'}`)
      lines.push('')
    }
  }

  if (comparison.needsReview.length > 0) {
    lines.push('--- Bundles Needing Content Review ---')
    for (const b of comparison.needsReview) {
      lines.push(`! Bundle ${b.bundleId} [${b.identity.postId ?? 'unknown identity'}]`)
      lines.push(`  URL: ${b.identity.canonicalUrl ?? b.rawUrl ?? '(none)'}`)
      lines.push(`  Next human action: ${b.classificationReason ?? 'Provide usable textual evidence or an accepted media-analysis mechanism'}`)
      lines.push('')
    }
  }

  if (comparison.incomplete.length > 0) {
    lines.push('--- Incomplete Bundles ---')
    for (const b of comparison.incomplete) {
      lines.push(`? Bundle ${b.bundleId}: ${b.classificationReason ?? 'Missing required information'}`)
    }
    lines.push('')
  }

  lines.push('==================================================')
  if (comparison.newSources.length === 0 && comparison.changedSources.length === 0) {
    lines.push('Corpus is ALREADY CURRENT. No production changes required.')
  } else {
    lines.push('PREVIEW ONLY: No production changes have been made.')
    lines.push('To admit approved sources into production, run:')
    lines.push('  npm run buglasan:update -- --confirm-production')
  }
  lines.push('==================================================')

  return lines.join('\n')
}

export interface DownstreamWorkerOptions {
  supabaseUrl: string
  serviceKey: string
  indexingToken?: string
  extractionToken?: string
  reconciliationToken?: string
  fetch?: typeof globalThis.fetch
}

export type DownstreamStatus =
  | 'indexed'
  | 'no_text'
  | 'extracted'
  | 'no_event'
  | 'reconciled'
  | 'needs_review'
  | 'provider_unavailable'
  | 'permanent_error'
  | 'skipped'

export async function invokeDownstreamForSource(
  sourceId: string,
  options: DownstreamWorkerOptions,
): Promise<{
  indexing: DownstreamStatus
  extraction: DownstreamStatus
  reconciliations: string[]
}> {
  const request = options.fetch ?? globalThis.fetch
  const base = options.supabaseUrl.replace(/\/$/, '')
  const headers = { 'content-type': 'application/json', apikey: options.serviceKey, authorization: `Bearer ${options.serviceKey}` }

  let indexingResult: DownstreamStatus = 'skipped'
  let extractionResult: DownstreamStatus = 'skipped'
  const reconciliations: string[] = []

  // 1. Index Source
  if (options.indexingToken) {
    try {
      const resp = await request(`${base}/functions/v1/index-source`, {
        method: 'POST',
        headers: { ...headers, 'x-index-source-token': options.indexingToken },
        body: JSON.stringify({ source_id: sourceId }),
      })
      if (resp.status === 429 || resp.status === 503 || resp.status === 504) {
        indexingResult = 'provider_unavailable'
      } else if (!resp.ok) {
        indexingResult = 'permanent_error'
      } else {
        const data = await resp.json() as { status?: string }
        indexingResult = (data.status as typeof indexingResult) ?? 'indexed'
      }
    } catch {
      indexingResult = 'provider_unavailable'
    }
  }

  // 2. Extract Source
  let extractData: { status?: string } | null = null
  if (options.extractionToken) {
    try {
      const resp = await request(`${base}/functions/v1/extract-source`, {
        method: 'POST',
        headers: { ...headers, 'x-extraction-token': options.extractionToken },
        body: JSON.stringify({ source_id: sourceId }),
      })
      if (resp.status === 429 || resp.status === 503 || resp.status === 504) {
        extractionResult = 'provider_unavailable'
      } else if (!resp.ok) {
        extractionResult = 'permanent_error'
      } else {
        extractData = await resp.json() as { status?: string }
        if (extractData.status === 'retryable_error') {
          extractionResult = 'provider_unavailable'
        } else {
          extractionResult = (extractData.status as DownstreamStatus) ?? 'extracted'
        }
      }
    } catch {
      extractionResult = 'provider_unavailable'
    }
  }

  // 3. Reconcile Candidates if extracted
  if ((extractionResult === 'extracted' || extractionResult === 'no_event') && options.reconciliationToken) {
    try {
      const eventsResp = await request(`${base}/rest/v1/events?extracted_source_id=eq.${encodeURIComponent(sourceId)}&is_current=eq.true&select=id`, {
        method: 'GET',
        headers,
      })
      if (eventsResp.ok) {
        const events = await eventsResp.json() as Array<{ id: string }>
        for (const ev of events) {
          try {
            const rResp = await request(`${base}/functions/v1/reconcile-event`, {
              method: 'POST',
              headers: { ...headers, 'x-reconcile-event-token': options.reconciliationToken },
              body: JSON.stringify({ candidate_event_id: ev.id }),
            })
            if (rResp.status === 429 || rResp.status === 503 || rResp.status === 504) {
              reconciliations.push('provider_unavailable')
            } else if (!rResp.ok) {
              reconciliations.push('permanent_error')
            } else {
              const rData = await rResp.json() as { status?: string }
              reconciliations.push(rData.status ?? 'reconciled')
            }
          } catch {
            reconciliations.push('provider_unavailable')
          }
        }
      }
    } catch {
      // events query failure
    }
  }

  return {
    indexing: indexingResult,
    extraction: extractionResult,
    reconciliations,
  }
}

export interface ExecuteIntakeOptions {
  confirmProduction: boolean
  supabaseUrl?: string
  supabaseSecretKey?: string
  indexingToken?: string
  extractionToken?: string
  reconciliationToken?: string
  dispatcher?: (payload: SourceIngestionPayload, options?: ProductionDispatcherOptions) => Promise<ProductionIngestionReceipt>
  downstreamRunner?: (sourceId: string, options: DownstreamWorkerOptions) => Promise<{
    indexing: string
    extraction: string
    reconciliations: string[]
  }>
  executionReportPath?: string
  collectedAt?: string
  /**
   * Media analysis provider for image-bearing bundles. It defaults to the
   * established deterministic-local provider so existing behavior is unchanged;
   * a caller that provisions the checked-in offline Tesseract runtime passes an
   * OCR-backed provider so image-derived text reaches source knowledge.
   */
  imageProvider?: MediaAnalysisProvider
  /**
   * Bundle ids (or 'all') whose already-known sources are re-processed so improved
   * media analysis can reach the same durable source. This never duplicates a
   * source: the collector upserts by (platform, post_id), so an unchanged payload
   * returns an idempotent no-op and only genuinely enriched text advances the
   * fingerprint that downstream indexing and extraction are keyed on.
   */
  reanalyzeBundles?: readonly string[] | 'all'
}

/**
 * Already-known bundles selected for deliberate re-analysis. Without an explicit
 * selection this is always empty, so the normal update path never re-dispatches
 * unchanged sources.
 */
export function selectReanalyzeCandidates(unchanged: readonly ScannedBundle[], selection: readonly string[] | 'all' | undefined): ScannedBundle[] {
  if (selection === undefined) return []
  if (selection === 'all') return [...unchanged]
  const wanted = new Set(selection)
  return unchanged.filter((bundle) => wanted.has(bundle.bundleId))
}

export async function executeIntake(
  comparison: CorpusComparison,
  options: ExecuteIntakeOptions,
): Promise<UpdateExecutionResult> {
  if (options.confirmProduction !== true) {
    return {
      status: 'preview_only',
      confirmationProvided: false,
      comparison,
      admitted: [],
      downstreamReport: {
        indexed: 0,
        extracted: 0,
        noEvent: 0,
        needsReview: 0,
        reconciled: 0,
        providerUnavailable: 0,
        permanentError: 0,
        unsafeFailures: 0,
      },
    }
  }

  const eligible = [...comparison.newSources, ...comparison.changedSources, ...selectReanalyzeCandidates(comparison.unchanged, options.reanalyzeBundles)]
  if (eligible.length === 0) {
    return {
      status: 'already_current',
      confirmationProvided: true,
      comparison,
      admitted: [],
      downstreamReport: {
        indexed: 0,
        extracted: 0,
        noEvent: 0,
        needsReview: 0,
        reconciled: 0,
        providerUnavailable: 0,
        permanentError: 0,
        unsafeFailures: 0,
      },
    }
  }

  const dispatch = options.dispatcher ?? dispatchApprovedProductionSource
  const downstreamFn = options.downstreamRunner ?? invokeDownstreamForSource
  const imageProvider = options.imageProvider ?? deterministicLocalImageProvider
  const collectedAt = options.collectedAt ?? new Date().toISOString()

  const admitted: AdmittedSourceOutcome[] = []
  const downstreamReport: DownstreamReport = {
    indexed: 0,
    extracted: 0,
    noEvent: 0,
    needsReview: 0,
    reconciled: 0,
    providerUnavailable: 0,
    permanentError: 0,
    unsafeFailures: 0,
  }

  for (const bundle of eligible) {
    const postUrl = bundle.identity.canonicalUrl!
    const isReel = /^https:\/\/www\.facebook\.com\/reel\//.test(postUrl)

    // Build images for source inbox
    const inboxImages: SourceInboxImage[] = bundle.media
      .filter((m) => m.kind === 'image' && m.mimeType && m.bytes)
      .map((m) => ({ name: m.name, mimeType: m.mimeType!, bytes: m.bytes! }))

    const inboxVideos: SourceInboxVideo[] = bundle.media
      .filter((m) => m.kind === 'video' && m.mimeType && m.bytes)
      .map((m) => ({ name: m.name, mimeType: m.mimeType!, bytes: m.bytes! }))

    // Analyze via source inbox
    const preview = await analyzeSourceInbox({
      facebookPostUrl: postUrl,
      operatorCaption: bundle.caption,
      images: inboxImages,
      videos: inboxVideos,
      collectedAt,
      festivalYear: 2026,
    }, imageProvider)

    // Approve preview to payload
    const payload = approveSourceInboxPreview(preview, (p) => p, {
      confirmOcrReview: true,
      confirmOfficialBuglasanSource: isReel,
    })

    // Dispatch approved source to production boundary
    const receipt = await dispatch(payload, {
      supabaseUrl: options.supabaseUrl,
      supabaseSecretKey: options.supabaseSecretKey,
    })

    // Invoke downstream processing
    const dsResult = await downstreamFn(receipt.sourceId, {
      supabaseUrl: options.supabaseUrl ?? process.env.SUPABASE_URL ?? '',
      serviceKey: options.supabaseSecretKey ?? process.env.SUPABASE_SECRET_KEY ?? '',
      indexingToken: options.indexingToken ?? process.env.INDEX_SOURCE_TOKEN,
      extractionToken: options.extractionToken ?? process.env.EXTRACT_SOURCE_TOKEN,
      reconciliationToken: options.reconciliationToken ?? process.env.RECONCILE_EVENT_TOKEN,
    })

    // Tally downstream report
    if (dsResult.indexing === 'indexed') downstreamReport.indexed++
    else if (dsResult.indexing === 'provider_unavailable') downstreamReport.providerUnavailable++
    else if (dsResult.indexing === 'permanent_error') downstreamReport.permanentError++
    else if (dsResult.indexing === 'needs_review') downstreamReport.needsReview++

    if (dsResult.extraction === 'extracted') downstreamReport.extracted++
    else if (dsResult.extraction === 'no_event') downstreamReport.noEvent++
    else if (dsResult.extraction === 'needs_review') downstreamReport.needsReview++
    else if (dsResult.extraction === 'provider_unavailable') downstreamReport.providerUnavailable++
    else if (dsResult.extraction === 'permanent_error') downstreamReport.permanentError++

    for (const r of dsResult.reconciliations) {
      if (r === 'reconciled') downstreamReport.reconciled++
      else if (r === 'provider_unavailable') downstreamReport.providerUnavailable++
      else if (r === 'permanent_error') downstreamReport.permanentError++
      else if (r === 'needs_review') downstreamReport.needsReview++
    }

    admitted.push({
      bundleId: bundle.bundleId,
      postId: bundle.identity.postId!,
      sourceId: receipt.sourceId,
      status: receipt.status,
      downstream: dsResult,
    })
  }

  // Write auditable execution report
  const executionReport = {
    generated_at: collectedAt,
    status: 'intake_completed',
    admitted_count: admitted.length,
    admitted,
    downstream: downstreamReport,
    comparison_summary: {
      total: comparison.totalBundles,
      unchanged: comparison.unchanged.length,
      new: comparison.newSources.length,
      changed: comparison.changedSources.length,
      needs_review: comparison.needsIdentityReview.length,
      needs_content_review: comparison.needsReview.length,
    },
  }

  try {
    const reportPath = resolve(options.executionReportPath ?? DEFAULT_EXECUTION_REPORT_PATH)
    await mkdir(resolve('operator-manifests'), { recursive: true })
    await writeFile(reportPath, `${JSON.stringify(executionReport, null, 2)}\n`, 'utf8')
  } catch {
    // preserve execution outcome if file write fails
  }

  return {
    status: 'intake_completed',
    confirmationProvided: true,
    comparison,
    admitted,
    downstreamReport,
  }
}

export function formatStatusReport(result: UpdateExecutionResult): string {
  const comp = result.comparison
  const ds = result.downstreamReport

  const lines: string[] = [
    '==================================================',
    'Buglasan Source Update Report',
    '==================================================',
    '',
    `${comp.totalBundles} source bundles scanned`,
    `${comp.unchanged.length} unchanged`,
    `${result.admitted.length} new admitted`,
    `${comp.changedSources.length} changed`,
    `${comp.needsIdentityReview.length} needs identity review`,
    `${comp.needsReview.length} needs content review`,
    '',
  ]

  if (result.status === 'already_current') {
    lines.push('Corpus is ALREADY CURRENT. No production changes were required.')
  } else if (result.status === 'preview_only') {
    lines.push('PREVIEW ONLY. Explicit confirmation (--confirm-production) required to execute intake.')
  } else {
    lines.push('Downstream processing:')
    lines.push(`  ${ds.indexed} indexed`)
    lines.push(`  ${ds.extracted} extracted`)
    if (ds.noEvent > 0) lines.push(`  ${ds.noEvent} no_event`)
    if (ds.needsReview > 0) lines.push(`  ${ds.needsReview} needs_review`)
    if (ds.providerUnavailable > 0) lines.push(`  ${ds.providerUnavailable} provider unavailable (retryable)`)
    if (ds.permanentError > 0) lines.push(`  ${ds.permanentError} permanent errors`)
    lines.push(`  ${ds.reconciled} reconciled`)
    lines.push(`  ${ds.unsafeFailures} unsafe failures`)
    lines.push('')
    lines.push('All admitted sources safely persisted.')
  }

  lines.push('==================================================')
  return lines.join('\n')
}

export async function fetchDurableSources(
  supabaseUrl?: string,
  serviceKey?: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<DurableSourceRecord[]> {
  const url = supabaseUrl ?? process.env.SUPABASE_URL
  const key = serviceKey ?? process.env.SUPABASE_SECRET_KEY

  // If live credentials available, fetch from Supabase
  if (url && key) {
    try {
      const resp = await fetchFn(`${url.replace(/\/$/, '')}/rest/v1/sources?platform=eq.facebook&select=id,post_id,post_url,content_fingerprint,is_current,status,source_type`, {
        headers: { apikey: key, authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (resp.ok) {
        const rows = await resp.json() as DurableSourceRecord[]
        if (Array.isArray(rows)) return rows
      }
    } catch {
      // Fallback to local manifests if network request fails
    }
  }

  // Fallback to durable local ledger (e.g. Gate 2B production execution record)
  const localExecutionPath = resolve('operator-manifests/gate2b-production-intake-execution.json')
  if (existsSync(localExecutionPath)) {
    try {
      const data = JSON.parse(readFileSync(localExecutionPath, 'utf8')) as {
        outcomes?: Array<{ bundle: number; post_id: string; canonical_url: string; dispatch?: { sourceId?: string } }>
      }
      if (Array.isArray(data.outcomes)) {
        return data.outcomes.map((o) => ({
          id: o.dispatch?.sourceId ?? `local-${o.bundle}`,
          post_id: o.post_id,
          post_url: o.canonical_url,
          content_fingerprint: null,
        }))
      }
    } catch {
      // ignore
    }
  }

  return []
}
