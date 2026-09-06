/** Phase 10 operator intake. Validation is the default; writes require two explicit gates. */
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { normalizeSourceIngestionPayload, type SourceIngestionPayload } from '../src/ingestion/sourceIngestion.ts'

export type ManifestRecord = SourceIngestionPayload & {
  provenance: { operator: string; reviewed_at: string; capture_note: string }
}

export type ManifestDiagnostic = { record: number; post_id?: string; reasons: string[] }
export type ManifestReport = {
  payloads: SourceIngestionPayload[]
  diagnostics: ManifestDiagnostic[]
  duplicates: string[]
  counts: {
    total: number; valid: number; invalid: number; duplicate: number; image_only: number; text_bearing: number
    festival_year_known: number; festival_year_null: number; rejected_reasons: Record<string, number>
  }
}

const OFFICIAL_POST_PATH = /^\/Buglasan\/posts\/(?:\d+|[^/]+\/\d+)\/?$/
const POST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/
const PROVENANCE_KEYS = new Set(['operator', 'reviewed_at', 'capture_note'])
const MANIFEST_KEYS = new Set([...['platform', 'post_id', 'post_url', 'published_at', 'post_year', 'festival_year', 'raw_text', 'normalized_text', 'title', 'source_type', 'media_urls', 'collected_at', 'collection_method', 'source_metadata'], 'provenance'])

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateOfficialUrl(value: unknown, postId: unknown, issues: string[]): void {
  if (typeof value !== 'string') {
    issues.push('post_url must be an exact trusted HTTPS www.facebook.com/Buglasan post URL')
    return
  }
  try {
    const url = new URL(value.trim())
    const finalId = url.pathname.match(/\/(\d+)\/?$/)?.[1]
    if (url.protocol !== 'https:' || url.hostname !== 'www.facebook.com' || url.port || url.username || url.password || url.search || url.hash || !OFFICIAL_POST_PATH.test(url.pathname) || finalId !== postId) {
      issues.push('post_url must be an exact trusted HTTPS www.facebook.com/Buglasan post URL whose final numeric ID equals post_id')
    }
  } catch {
    issues.push('post_url must be an exact trusted HTTPS www.facebook.com/Buglasan post URL')
  }
}

/** Converts one operator record to the existing source ingestion contract without writing data. */
export function validateManifestRecord(input: unknown): SourceIngestionPayload {
  if (!record(input)) throw new Error('manifest record must be an object')
  const issues: string[] = []
  for (const key of Object.keys(input)) if (!MANIFEST_KEYS.has(key)) issues.push(`unknown field: ${key}`)
  validateOfficialUrl(input.post_url, input.post_id, issues)
  if (typeof input.post_id !== 'string' || !POST_ID.test(input.post_id.trim())) issues.push('post_id must be a stable 3-128 character identifier')
  if (!record(input.provenance)) issues.push('provenance is required')
  else {
    for (const key of Object.keys(input.provenance)) if (!PROVENANCE_KEYS.has(key)) issues.push(`unknown provenance field: ${key}`)
    for (const key of PROVENANCE_KEYS) if (typeof input.provenance[key] !== 'string' || !input.provenance[key].trim()) issues.push(`provenance.${key} must be a non-empty string`)
  }
  if (issues.length) throw new Error(issues.join('; '))
  // Provenance is deliberately preserved as metadata while the RPC-facing shape remains canonical.
  const { provenance, ...payload } = input
  return normalizeSourceIngestionPayload({
    ...payload,
    source_metadata: { ...(record(input.source_metadata) ? input.source_metadata : {}), provenance: provenance as Record<string, unknown> },
  })
}

export function parseManifestText(text: string, format: 'json' | 'jsonl' = 'json'): unknown[] {
  if (format === 'jsonl') return text.split(/\r?\n/).map((line, index) => {
    if (!line.trim()) return null
    try { return JSON.parse(line) } catch { throw new Error(`invalid JSONL at line ${index + 1}`) }
  }).filter((value): value is unknown => value !== null)
  const parsed: unknown = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : [parsed]
}

export function validateManifest(records: unknown[]): ManifestReport {
  const ids = new Set<string>(), duplicates: string[] = [], payloads: SourceIngestionPayload[] = [], diagnostics: ManifestDiagnostic[] = []
  records.forEach((input, index) => {
    try {
      const payload = validateManifestRecord(input)
      if (ids.has(payload.post_id)) {
        const message = `duplicate post_id: ${payload.post_id}`
        duplicates.push(`record ${index + 1}: ${message}`)
        diagnostics.push({ record: index + 1, post_id: payload.post_id, reasons: [message] })
        return
      }
      ids.add(payload.post_id); payloads.push(payload)
    } catch (error) {
      const reasons = error instanceof Error ? error.message.split('; ') : ['invalid manifest record']
      const postId = record(input) && typeof input.post_id === 'string' ? input.post_id : undefined
      diagnostics.push({ record: index + 1, ...(postId ? { post_id: postId } : {}), reasons })
    }
  })
  const rejected_reasons: Record<string, number> = {}
  for (const diagnostic of diagnostics) for (const reason of diagnostic.reasons) rejected_reasons[reason] = (rejected_reasons[reason] ?? 0) + 1
  return {
    payloads, diagnostics, duplicates,
    counts: {
      total: records.length, valid: payloads.length, invalid: diagnostics.filter((d) => !d.reasons.some((r) => r.startsWith('duplicate post_id:'))).length,
      duplicate: duplicates.length, image_only: payloads.filter((p) => !p.raw_text && !p.normalized_text).length,
      text_bearing: payloads.filter((p) => Boolean(p.raw_text || p.normalized_text)).length,
      festival_year_known: payloads.filter((p) => p.festival_year !== null).length,
      festival_year_null: payloads.filter((p) => p.festival_year === null).length, rejected_reasons,
    },
  }
}

const SHELL_PUNCTUATION = new Set([';', ',', ')', ']', '}'])
export function parseArguments(argv: string[]): { file: string; mode: 'ingest' | 'plan' | 'validate' } {
  const positional = argv
    .filter((arg) => !arg.startsWith('--'))
    .map((arg) => arg.replace(/[;,)\]}]+$/, ''))
    .filter((arg) => arg.length > 0 && !SHELL_PUNCTUATION.has(arg))
  if (positional.length === 0) throw new Error('usage: phase10:manifest --validate|--plan <manifest.json|.jsonl>')
  if (positional.length > 1) throw new Error(`expected exactly one positional manifest path; received ${positional.length}`)
  const modes = argv.filter((arg) => ['--validate', '--plan', '--ingest'].includes(arg))
  if (modes.length > 1) throw new Error('choose exactly one mode: --validate, --plan, or --ingest')
  return { file: positional[0], mode: argv.includes('--ingest') ? 'ingest' : argv.includes('--plan') ? 'plan' : 'validate' }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { file, mode } = parseArguments(argv)
  if (mode === 'ingest' && !(argv.includes('--i-understand-production-write') && process.env.PHASE10_PRODUCTION_INGEST === 'true')) {
    throw new Error('production modes require --i-understand-production-write and PHASE10_PRODUCTION_INGEST=true')
  }
  const format = file.endsWith('.jsonl') ? 'jsonl' : 'json'
  const result = validateManifest(parseManifestText(readFileSync(file, 'utf8'), format))
  if (mode === 'ingest') throw new Error('ingest mode is gated but not implemented: use an approved operator adapter')
  const report = mode === 'plan' ? {
    mode, non_mutating: true, writes: 0,
    records: result.payloads.map((p) => ({ record_id: p.post_id, ingest_source: { platform: p.platform, post_id: p.post_id, source_type: p.source_type, collection_method: p.collection_method, festival_year: p.festival_year }, image_only: !p.raw_text && !p.normalized_text })),
    counts: result.counts, diagnostics: result.diagnostics,
  } : { mode, ...result.counts, diagnostics: result.diagnostics, writes: 0 }
  console.log(JSON.stringify(report, null, 2))
  if (result.diagnostics.length > 0) process.exitCode = 1
}

if (import.meta.main) await main()
