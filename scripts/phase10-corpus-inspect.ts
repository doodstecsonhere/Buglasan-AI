/** Phase 10 exact-ten corpus inspection. GET-only; it never calls an RPC or worker. */
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { parseManifestText, parseOfficialFacebookPostIdentity, validateManifest } from './phase10-manifest-intake.ts'
import { loadEnvLocal } from './phase10-status.ts'

export const AUGUST_23_POST_ID = '1475245514640502'
export const MAX_ROWS = 1000
const EXTRACTOR_VERSION = 'phase6-v1'
const INDEXER_VERSION = 'semantic-index-v1'
const EMBEDDING_MODEL = 'gemini-embedding-001'

export type Row = Record<string, unknown>
export type ReadRequest = (url: string, init?: RequestInit) => Promise<Response>
export type InspectorOptions = { url: string; key: string; request?: ReadRequest; maxRows?: number }
export type CorpusInspection = {
  read_only: true; writes: 0; manifest_records: number; resolved_records: number
  sources: Array<Record<string, unknown>>
  terminal_failures: Array<Record<string, unknown>>
  evidence_check: Record<string, unknown>
}

function rows(value: unknown, label: string): Row[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error(`${label} response must be an array of objects`)
  return value as Row[]
}
function required(row: Row, fields: string[], label: string): void {
  for (const field of fields) if (!(field in row) || row[field] === null || (typeof row[field] === 'string' && !row[field].trim())) throw new Error(`${label} response is missing required ${field}`)
}
function enc(value: unknown): string { return encodeURIComponent(String(value)) }
function production(row: Row): boolean {
  const text = JSON.stringify(row.source_metadata ?? '').toLowerCase()
  const provenance = row.source_metadata && typeof row.source_metadata === 'object' && !Array.isArray(row.source_metadata) ? (row.source_metadata as Row).provenance : undefined
  const validProvenance = provenance && typeof provenance === 'object' && !Array.isArray(provenance) && ['operator', 'reviewed_at', 'capture_note'].every((field) => typeof (provenance as Row)[field] === 'string' && Boolean(String((provenance as Row)[field]).trim()))
  return row.platform === 'facebook' && typeof row.post_id === 'string' && /^\d+$/.test(row.post_id) && ['manual', 'meta_graph_api', 'admin_export'].includes(String(row.collection_method)) && validProvenance === true && !/synthetic|fixture|acceptance|smoke|test/.test(text) && row.is_current === true && ['active', 'updated', 'postponed'].includes(String(row.status))
}
function hasOfficialPostIdentity(row: Row, expectedPostId: string): boolean {
  return parseOfficialFacebookPostIdentity(row.post_url)?.postId === expectedPostId
}
function bounded(value: unknown): unknown {
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value
  if (Array.isArray(value)) return value.slice(0, 100).map(bounded)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bounded(item)]))
  return value
}
function redact(value: unknown): unknown {
  if (typeof value === 'string' && /(bearer|apikey|secret|token|password|credential)/i.test(value)) return '[redacted]'
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /key|token|secret|password|credential|authorization/i.test(key) ? '[redacted]' : redact(item)]))
  return value
}

async function getRows(base: string, key: string, path: string, request: ReadRequest): Promise<Row[]> {
  const response = await request(`${base}/rest/v1/${path}`, { method: 'GET', redirect: 'error', headers: { apikey: key, authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) })
  if (!response.ok) {
    const detail = response.status >= 400 && response.status < 500 ? (await response.text()).replace(/https?:\/\/[^\s"']+/gi, '[url redacted]').replace(/(bearer|apikey|secret|token|password|credential|authorization)(?:\s*[:=]\s*|\s+)[^\s,;}]*/gi, '[redacted]').slice(0, 500) : ''
    throw new Error(`read failed: HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  const label = path.split('?')[0]
  const result = rows(await response.json(), label)
  for (const row of result) {
    if (label === 'sources') required(row, ['id', 'platform', 'post_id', 'post_url', 'is_current', 'status', 'collection_method', 'source_metadata'], label)
    // The evidence-only query intentionally selects content alone; all other
    // chunk queries include the durable-currentness fields.
    if (label === 'source_chunks' && path.includes('is_current=eq.true')) required(row, ['content', 'is_current'], label)
  }
  return result
}

async function getRowsByIds(base: string, key: string, table: string, column: string, ids: unknown[], suffix: string, request: ReadRequest): Promise<Row[]> {
  if (ids.length === 0) return []
  return getRows(base, key, `${table}?${column}=in.(${ids.map(enc).join(',')})${suffix}`, request)
}

/** Inspect only manifest-bound, current, non-fixture rows. Every collection is bounded. */
export async function inspectManifest(manifest: unknown[], options: InspectorOptions): Promise<CorpusInspection> {
  if (!options.key) throw new Error('read-only service credential required')
  const request = options.request ?? fetch, limit = options.maxRows ?? MAX_ROWS
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('maxRows must be a positive integer')
  const validation = validateManifest(manifest)
  if (validation.diagnostics.length) throw new Error(`manifest validation failed: ${validation.diagnostics.map((d) => d.reasons.join(', ')).join('; ')}`)
  const expected = validation.payloads
  const allSources = await getRows(options.url, options.key, `sources?platform=eq.facebook&select=*&limit=${limit + 1}`, request)
  if (allSources.length > limit) throw new Error(`sources result exceeds bounded limit ${limit}`)
  const productionSources = allSources.filter(production)
  const expectedIds = new Set(expected.map((item) => item.post_id))
  const outOfManifest = productionSources.filter((row) => !expectedIds.has(String(row.post_id)))
  if (outOfManifest.length) throw new Error(`out-of-manifest production sources: ${outOfManifest.map((row) => String(row.post_id)).join(', ')}`)
  const inspected: Array<Record<string, unknown>> = []
  const terminalFailures: Array<Record<string, unknown>> = []
  for (const manifestRow of expected) {
    const identityMatches = productionSources.filter((row) => row.post_id === manifestRow.post_id)
    if (identityMatches.length !== 1) throw new Error(`source identity ${manifestRow.post_id} is ${identityMatches.length === 0 ? 'missing' : 'ambiguous'} or duplicated`)
    const source = identityMatches[0]
    required(source, ['id', 'platform', 'post_id', 'post_url', 'collection_method', 'source_metadata', 'raw_text', 'normalized_text'], 'sources')
    if (!hasOfficialPostIdentity(manifestRow, manifestRow.post_id) || !hasOfficialPostIdentity(source, manifestRow.post_id)) throw new Error(`source identity ${manifestRow.post_id} has invalid URL`)
    const sourceId = String(source.id)
    const [extractions, indexings, events, links, chunks, runs] = await Promise.all([
      getRows(options.url, options.key, `source_extractions?source_id=eq.${enc(sourceId)}&extractor_version=eq.${EXTRACTOR_VERSION}&select=*&limit=${limit + 1}`, request),
      getRows(options.url, options.key, `source_indexings?source_id=eq.${enc(sourceId)}&indexer_version=eq.${INDEXER_VERSION}&embedding_model=eq.${EMBEDDING_MODEL}&embedding_dimensions=eq.768&select=*&limit=${limit + 1}`, request),
      getRows(options.url, options.key, `events?extracted_source_id=eq.${enc(sourceId)}&select=*&limit=${limit + 1}`, request),
      getRows(options.url, options.key, `event_sources?source_id=eq.${enc(sourceId)}&select=*&limit=${limit + 1}`, request),
      getRows(options.url, options.key, `source_chunks?source_id=eq.${enc(sourceId)}&is_current=eq.true&select=id,source_id,chunk_index,content,content_hash,source_fingerprint,indexer_version,embedding_model,embedding_dimensions,is_current&limit=${limit + 1}`, request),
      getRows(options.url, options.key, `event_reconciliation_runs?candidate_source_id=eq.${enc(sourceId)}&select=*&limit=${limit + 1}`, request),
    ])
    const associations = await getRowsByIds(options.url, options.key, 'event_candidate_associations', 'candidate_event_id', events.map((row) => row.id), '&select=*&limit=' + (limit + 1), request)
    const versions = await getRowsByIds(options.url, options.key, 'canonical_event_versions', 'canonical_event_id', associations.map((row) => row.canonical_event_id).filter(Boolean), '&select=*&limit=' + (limit + 1), request)
    const history = await getRows(options.url, options.key, `canonical_event_field_history?source_id=eq.${enc(sourceId)}&select=*&limit=${limit + 1}`, request)
    for (const [kind, collection] of [['extraction', extractions], ['indexing', indexings], ['reconciliation', runs]] as const) for (const row of collection) if (row.status === 'permanent_error') terminalFailures.push({ source_id: sourceId, post_id: source.post_id, kind, status: row.status, error_code: row.last_error_code, attempt_count: row.attempt_count })
    inspected.push({
      identity: { source_id: sourceId, platform: source.platform, post_id: source.post_id, post_url: source.post_url },
      source: bounded(source), extraction: bounded(extractions), indexing: bounded(indexings), reconciliation: bounded(runs),
      links: bounded(links), events: bounded(events), chunks: bounded(chunks), citations: bounded(history), years: { post_year: source.post_year, festival_year: source.festival_year },
      canonical: bounded({ associations, versions }),
    })
  }
  const evidenceSource = productionSources.find((row) => row.post_id === AUGUST_23_POST_ID)
  const evidenceChunks = evidenceSource ? await getRows(options.url, options.key, `source_chunks?source_id=eq.${enc(String(evidenceSource.id))}&is_current=eq.true&select=content,is_current&limit=${limit + 1}`, request) : []
  const target = inspected.find((item) => (item.identity as Row).post_id === AUGUST_23_POST_ID)
  const sourceText = evidenceSource ? [evidenceSource.raw_text, evidenceSource.normalized_text, ...evidenceChunks.map((row) => row.content)].filter((value): value is string => typeof value === 'string').join('\n').toLowerCase() : ''
  const matched = /aug(?:ust)?\s+23|23\s+aug(?:ust)?|(?:08|8)[/-]23/.test(sourceText)
  return redact({ read_only: true, writes: 0, manifest_records: expected.length, resolved_records: inspected.length, sources: inspected, terminal_failures: terminalFailures, evidence_check: { post_id: AUGUST_23_POST_ID, query: 'August 23', matched, stored_source_or_chunk_text_only: true, status: target ? (matched ? 'passed' : 'failed') : 'not_in_manifest' } }) as CorpusInspection
}

export function parseArguments(argv: string[]): string {
  const paths = argv.filter((arg) => !arg.startsWith('--')).map((arg) => arg.replace(/[;,)}\]]+$/, ''))
  if (paths.length !== 1) throw new Error('usage: phase10:corpus-inspect <manifest.json|.jsonl>')
  return paths[0]
}

if (import.meta.main) {
  loadEnvLocal()
  const file = parseArguments(process.argv.slice(2)), format = file.endsWith('.jsonl') ? 'jsonl' : 'json'
  const validation = validateManifest(parseManifestText(readFileSync(file, 'utf8'), format))
  if (validation.diagnostics.length) throw new Error(`manifest validation failed: ${JSON.stringify(validation.diagnostics)}`)
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required')
  console.log(JSON.stringify(await inspectManifest(parseManifestText(readFileSync(file, 'utf8'), format), { url, key }), null, 2))
}
