import { readFileSync, writeFileSync } from 'node:fs'

export const OLD_EXTRACTOR_VERSION = 'phase6-v1'
export const RECOVERY_EXTRACTOR_VERSION = 'phase6-v2'
export const OPERATOR_CONFIRMATION = 'I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION'
export const RECOVERABLE_ERRORS = new Set(['extraction_unknown_failure', 'extraction_invalid_content', 'extraction_invalid_structure'])

type SourceRow = { id: string; is_current: boolean; status: string; content_fingerprint: string }
type ExtractionRow = { id: string; source_id: string; source_fingerprint: string; extractor_version: string; status: string; last_error_code: string | null }
type Api = (path: string, init?: RequestInit) => Promise<Response>

export function admittedSourceIds(artifact: { outcomes?: Array<{ dispatch?: { sourceId?: unknown } }> }): string[] {
  const ids = (artifact.outcomes ?? []).map((outcome) => outcome.dispatch?.sourceId)
  if (ids.length !== 27 || ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('Gate 2B artifact must contain 27 unique source IDs')
  return ids as string[]
}

export function eligibleForVersionRecovery(source: SourceRow | undefined, previous: ExtractionRow | undefined, replacement: ExtractionRow | undefined): boolean {
  return !!source && source.is_current && ['active', 'updated', 'postponed'].includes(source.status)
    && !!previous && previous.source_id === source.id && previous.source_fingerprint === source.content_fingerprint
    && previous.extractor_version === OLD_EXTRACTOR_VERSION && previous.status === 'permanent_error'
    && RECOVERABLE_ERRORS.has(previous.last_error_code ?? '') && !replacement
}

async function json(api: Api, path: string, init?: RequestInit): Promise<unknown> {
  const response = await api(path, init)
  const text = await response.text()
  if (!response.ok) throw new Error(`production request failed: ${response.status}`)
  return text ? JSON.parse(text) : null
}

export async function recover(): Promise<void> {
  if (process.argv[2] !== '--execute' || process.env.GATE2B_EXTRACTION_VERSION_RECOVERY !== OPERATOR_CONFIRMATION) throw new Error('Use --execute with explicit Gate 2B recovery confirmation')
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  const token = process.env.EXTRACT_SOURCE_TOKEN
  const expectedRef = process.env.SUPABASE_EXPECTED_PROJECT_REF
  if (!url || !key || !token || !expectedRef || new URL(url).hostname.split('.')[0] !== expectedRef) throw new Error('Incomplete or mismatched production configuration')
  const artifact = JSON.parse(readFileSync('operator-manifests/gate2b-production-intake-execution.json', 'utf8'))
  const ids = admittedSourceIds(artifact)
  const api: Api = (path, init = {}) => fetch(`${url}${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers ?? {}) } })
  const outcomes: Array<Record<string, unknown>> = []
  for (const sourceId of ids) {
    const sourceRows = await json(api, `/rest/v1/sources?id=eq.${sourceId}&select=id,is_current,status,content_fingerprint` ) as SourceRow[]
    const previousRows = await json(api, `/rest/v1/source_extractions?source_id=eq.${sourceId}&source_fingerprint=eq.${sourceRows[0]?.content_fingerprint ?? ''}&extractor_version=eq.${OLD_EXTRACTOR_VERSION}&select=id,source_id,source_fingerprint,extractor_version,status,last_error_code` ) as ExtractionRow[]
    const replacementRows = await json(api, `/rest/v1/source_extractions?source_id=eq.${sourceId}&source_fingerprint=eq.${sourceRows[0]?.content_fingerprint ?? ''}&extractor_version=eq.${RECOVERY_EXTRACTOR_VERSION}&select=id,source_id,source_fingerprint,extractor_version,status,last_error_code` ) as ExtractionRow[]
    const source = sourceRows[0]
    const previous = previousRows[0]
    if (!eligibleForVersionRecovery(source, previous, replacementRows[0])) continue
    const response = await fetch(`${url}/functions/v1/extract-source`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-extraction-token': token }, body: JSON.stringify({ source_id: sourceId }) })
    const body = await response.json()
    outcomes.push({ source_id: sourceId, status: body.status, http_status: response.status })
  }
  writeFileSync('gate-b-operator.local/gate2b-extraction-version-recovery.json', JSON.stringify({ extractor_version: RECOVERY_EXTRACTOR_VERSION, previous_extractor_version: OLD_EXTRACTOR_VERSION, outcomes }, null, 2))
  console.log(JSON.stringify({ extractor_version: RECOVERY_EXTRACTOR_VERSION, request_count: outcomes.length, outcomes }, null, 2))
}

if (process.argv[1]?.endsWith('gate2b-extraction-version-recovery.ts')) await recover()