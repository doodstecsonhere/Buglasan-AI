/**
 * Explicitly authorized, one-shot local Phase 10 operator runner.
 *
 * This file is intentionally separate from phase10-terminal-retry.ts. It reads
 * the complete before-images first, and only the deployed extract-source
 * boundary may perform the privileged claim and extraction.
 */
import process from 'node:process'
import { loadEnvLocal } from './phase10-status.ts'

export const PROJECT = 'https://uelezensmkxfyexcwqzb.supabase.co'
export const SOURCE_IDS = Object.freeze([
  '0f73eba4-daa0-48ca-82a8-a4ae02284793',
  '2d9a28eb-a142-4bc2-b694-530d141e0cbc',
  '8f0d3c75-a084-410c-8d1b-0800655cec21',
  'b025846e-1928-4ac9-95dd-cf02972dd0dc',
] as const)
export const EXCLUDED_SOURCE_ID = '254d56af-7bf4-4913-8a9b-d5ab34367b33'
export const EXTRACTOR_VERSION = 'phase6-v1'
const MAX_ERROR_TEXT = 160
const SINGLE_ROW_LIMIT = 2
const EXISTENCE_CHECK_LIMIT = 1

type Row = Record<string, unknown>
type Requester = typeof fetch
type RunnerOptions = {
  sourceId: string
  execute?: boolean
  supabaseKey: string
  extractionToken: string
  operatorToken?: string
  request?: Requester
  project?: string
}

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bounded(value: unknown): string {
  return String(value).replace(/[\r\n\t]+/g, ' ').slice(0, MAX_ERROR_TEXT)
}

export function assertAuthorizedSource(sourceId: string): asserts sourceId is (typeof SOURCE_IDS)[number] {
  if (sourceId === EXCLUDED_SOURCE_ID || !(SOURCE_IDS as readonly string[]).includes(sourceId)) {
    throw new Error('source is not in the fixed Phase 10 allowlist')
  }
}

export function parseArgs(args: string[]): { sourceId: string; execute: boolean } {
  const execute = args.includes('--execute')
  const values = args.filter((arg) => arg !== '--execute')
  if (values.length !== 1 || values[0].startsWith('-')) throw new Error('usage: phase10:terminal-recovery <authorized-source-id> [--execute]')
  assertAuthorizedSource(values[0])
  return { sourceId: values[0], execute }
}

async function getRows(project: string, key: string, path: string, request: Requester): Promise<Row[]> {
  const response = await request(`${project}/rest/v1/${path}`, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { apikey: key, authorization: `Bearer ${key}` },
  })
  if (!response.ok) throw new Error(`read failed: HTTP ${response.status}`)
  const body: unknown = await response.json()
  if (!Array.isArray(body) || body.some((row) => !isRecord(row))) throw new Error('unexpected read response shape')
  return body as Row[]
}

function eligible(source: Row, extraction: Row, candidates: Row[], links: Row[]): boolean {
  const provenance = source.source_metadata
  const metadata = isRecord(provenance) && isRecord(provenance.provenance) ? provenance.provenance : null
  const sourceText = typeof source.normalized_text === 'string' ? source.normalized_text : source.raw_text
  return source.is_current === true && source.platform === 'facebook'
    && typeof source.post_id === 'string' && /^[0-9]+$/.test(source.post_id)
    && typeof source.post_url === 'string' && source.post_url.startsWith('https://www.facebook.com/Buglasan/posts/')
    && ['active', 'updated', 'postponed'].includes(String(source.status))
    && typeof source.content_fingerprint === 'string' && /^[0-9a-f]{64}$/.test(source.content_fingerprint)
    && typeof sourceText === 'string' && sourceText.trim().length > 0
    && isRecord(source.source_metadata) && metadata !== null
    && ['operator', 'reviewed_at', 'capture_note'].every((field) => typeof metadata[field] === 'string' && metadata[field].trim() !== '' && metadata[field].length <= 2048)
    && !JSON.stringify(source.source_metadata).match(/synthetic|fixture|acceptance|smoke|test/i)
    && extraction.source_id === source.id && extraction.source_fingerprint === source.content_fingerprint
    && extraction.extractor_version === EXTRACTOR_VERSION && extraction.status === 'permanent_error'
    && extraction.attempt_count === 4 && extraction.last_error_code === 'extraction_failed'
    && extraction.claim_token == null && extraction.lease_expires_at == null
    && candidates.length === 0 && links.length === 0
}

export function summarize(source: Row, extraction: Row, execute: boolean, result?: Row) {
  return {
    source_id: bounded(source.id),
    source_status: bounded(source.status),
    source_fingerprint: bounded(source.content_fingerprint),
    extractor_version: bounded(extraction.extractor_version),
    extraction_status: bounded(extraction.status),
    attempt_count: extraction.attempt_count,
    mode: execute ? 'execute' : 'dry-run',
    result: result ? { status: bounded(result.status), source_id: bounded(result.source_id), persisted_candidates: result.persisted_candidates } : undefined,
  }
}

export async function recover(options: RunnerOptions) {
  assertAuthorizedSource(options.sourceId)
  if (!options.supabaseKey || !options.extractionToken) throw new Error('Supabase read credential and extraction token are required')
  if (options.execute && !options.operatorToken) throw new Error('PHASE10_OPERATOR_TOKEN is required with --execute')
  const request = options.request ?? fetch
  const project = options.project ?? PROJECT
  const id = encodeURIComponent(options.sourceId)
  const sourceRows = await getRows(project, options.supabaseKey, `sources?id=eq.${id}&select=*&limit=${SINGLE_ROW_LIMIT}`, request)
  const extractionRows = await getRows(project, options.supabaseKey, `source_extractions?source_id=eq.${id}&extractor_version=eq.${EXTRACTOR_VERSION}&select=*&limit=${SINGLE_ROW_LIMIT}`, request)
  const candidates = await getRows(project, options.supabaseKey, `events?extracted_source_id=eq.${id}&select=id&limit=${EXISTENCE_CHECK_LIMIT}`, request)
  const links = await getRows(project, options.supabaseKey, `event_sources?source_id=eq.${id}&select=event_id&limit=${EXISTENCE_CHECK_LIMIT}`, request)
  if (sourceRows.length !== 1 || extractionRows.length !== 1) throw new Error('source or extraction is missing or ambiguous')
  const source = sourceRows[0], extraction = extractionRows[0]
  if (source.id !== options.sourceId || extraction.source_id !== options.sourceId) throw new Error('source identity binding failed; no mutation attempted')
  if (!eligible(source, extraction, candidates, links)) throw new Error('source is not currently eligible; no mutation attempted')
  if (!options.execute) return summarize(source, extraction, false)

  const metadata = (source.source_metadata as Row).provenance as Row
  const response = await request(`${project}/functions/v1/extract-source`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120_000),
    headers: {
      'content-type': 'application/json', apikey: options.supabaseKey,
      'x-extraction-token': options.extractionToken,
      'x-phase10-operator-token': options.operatorToken!,
    },
    body: JSON.stringify({ source_id: source.id, source_fingerprint: source.content_fingerprint,
      extractor_version: EXTRACTOR_VERSION, source_before: source, extraction_before: extraction, operator_metadata: metadata }),
  })
  if (!response.ok) throw new Error('recovery stopped: claim consumed; outcome indeterminate; no retry')
  const body: unknown = await response.json()
  if (!isRecord(body) || body.source_id !== source.id || typeof body.status !== 'string'
    || !['extracted', 'no_event', 'needs_review', 'retryable_error', 'permanent_error'].includes(body.status)) {
    throw new Error('recovery stopped: unexpected response shape')
  }
  return summarize(source, extraction, true, body)
}

if (import.meta.main) {
  loadEnvLocal()
  const args = parseArgs(process.argv.slice(2))
  const report = await recover({ sourceId: args.sourceId, execute: args.execute,
    supabaseKey: process.env.SUPABASE_SECRET_KEY ?? '', extractionToken: process.env.EXTRACT_SOURCE_TOKEN ?? '',
    operatorToken: process.env.PHASE10_OPERATOR_TOKEN })
  // Deliberately print only bounded, non-secret metadata; never raw rows or response bodies.
  console.log(JSON.stringify(report))
}
