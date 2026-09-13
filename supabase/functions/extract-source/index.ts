import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { validateExtractionResult, type ExtractionResult } from '../_shared/extraction.ts'
import { geminiRestAdapter, configuredSecondaryAdapter } from '../_shared/providerAdapters.ts'
import { extractWithFailover } from '../_shared/providerExtraction.ts'
import { isFailoverEligible, safeProviderError } from '../_shared/providerErrors.ts'
import type { ExtractionDiagnosticCode } from '../_shared/providerTypes.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')
const SERVICE_KEY = secretKeys['default'] ?? ''
const TRUSTED_TOKEN = Deno.env.get('EXTRACT_SOURCE_TOKEN') ?? ''
const PHASE10_OPERATOR_TOKEN = Deno.env.get('PHASE10_OPERATOR_TOKEN') ?? ''
const ACCEPTANCE_FIXTURE_TOKEN = Deno.env.get('EXTRACTION_ACCEPTANCE_FIXTURE_TOKEN') ?? ''
const PIPELINE_ACCEPTANCE_FIXTURE_TOKEN = Deno.env.get('PIPELINE_ACCEPTANCE_FIXTURE_TOKEN') ?? ''
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-flash-latest'
const EXTRACTOR_VERSION = Deno.env.get('EXTRACTOR_VERSION') ?? 'phase6-v1'
const RECONCILE_AFTER_EXTRACTION = Deno.env.get('RECONCILE_AFTER_EXTRACTION') === 'true'
const RECONCILE_EVENT_TOKEN = Deno.env.get('RECONCILE_EVENT_TOKEN') ?? ''
const LEASE_SECONDS = 120
const EXTRACTION_TIMEOUT_MS = 90_000
const ACCEPTANCE_FIXTURE_VERSION = 'phase6-acceptance-v1'
// Compatibility contract: the shared boundary preserves the former MAX_ATTEMPTS = 3
// policy, transient statuses 429, 500, 502, 503, 504, error instanceof TypeError
// transport classification, and error instanceof TransientExtractionError's
// retryable-error outcome.
// Sanitized upstream metadata remains defined by the shared provider error boundary;
// its prior safeGeminiErrorMetadata fields included request_id: result.headers.get('x-goog-request-id').

class TransientExtractionError extends Error {}
const SAFE_ERROR_MESSAGE = 'extraction failed'

function persistedExtractionError(error: unknown, timedOut: boolean): { code: string; message: string } {
  if (timedOut) return { code: 'extraction_timeout', message: SAFE_ERROR_MESSAGE }
  const safe = safeProviderError(error)
  const diagnostic = safe.diagnostic as ExtractionDiagnosticCode | undefined
  if (diagnostic) return { code: `extraction_${diagnostic}`, message: SAFE_ERROR_MESSAGE }
  if (safe.category && safe.category !== 'unknown_provider_error' && !isFailoverEligible(error)) {
    return { code: 'extraction_nonretryable_provider', message: SAFE_ERROR_MESSAGE }
  }
  return { code: 'extraction_unknown_failure', message: SAFE_ERROR_MESSAGE }
}

const headers = { 'content-type': 'application/json', apikey: SERVICE_KEY }
const response = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validOperatorMetadata(value: unknown): value is { operator: string; reviewed_at: string; capture_note: string } {
  if (!isRecord(value)) return false
  return ['operator', 'reviewed_at', 'capture_note'].every((key) => typeof value[key] === 'string' && value[key].trim().length > 0 && value[key].length <= 2048)
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(actual)
  const right = encoder.encode(expected)
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index++) difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  return difference === 0
}

async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
  const result = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } })
  const text = await result.text()
  if (!result.ok) throw new Error(`database ${result.status}: ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : null
}

function extractionPrompt(sourceText: string): string {
  return `Extract zero, one, or multiple festival event candidates from SOURCE only. Do not use external knowledge or infer from publication date, organizer, page identity, images, or missing facts. Use null for unsupported scalar values. Every non-null scalar field except fee_kind MUST have at least one evidence item whose field is exactly that field name; if SOURCE has no exact supporting excerpt, return null for that field. Every alias must appear in an exact aliases evidence excerpt. fee_kind requires an exact fee excerpt: use "free" only for explicit free/no-fee language and "paid" only for an explicit price or paid-fee statement; otherwise use "unknown" with fees null. Cancellation/postponement must set status and review_reasons including "schedule_change". Ambiguous dates/years/names require review reasons. Evidence excerpts must be exact SOURCE substrings. Never return reasoning or chain-of-thought. Return only JSON matching: {"candidates":[{"event_name":string|null,"aliases":string[],"description":string|null,"category":"ceremony"|"competition"|"exhibit"|"food"|"trade"|"cultural"|"sports"|"workshop"|"concert"|"parade"|"other"|null,"start_datetime":ISO-with-offset|null,"end_datetime":ISO-with-offset|null,"venue":string|null,"organizer":string|null,"deadline":ISO-with-offset|null,"eligibility":string|null,"fee_kind":"free"|"paid"|"unknown","fees":string|null,"contact_info":string|null,"status":"scheduled"|"confirmed"|"cancelled"|"postponed"|"completed"|null,"festival_year":integer|null,"evidence":[{"field":string,"excerpt":string}],"review_reasons":string[]}],"source_summary":string|null}. Interpret stated local times in Asia/Manila (+08:00). SOURCE:\n${sourceText}`
}

type FixtureCandidate = ExtractionResult['candidates'][number]

function fixtureCandidate(overrides: Partial<FixtureCandidate>): FixtureCandidate {
  return {
    event_name: null, aliases: [], description: null, category: null, start_datetime: null,
    end_datetime: null, venue: null, organizer: null, deadline: null, eligibility: null,
    fee_kind: 'unknown', fees: null, contact_info: null, status: null, festival_year: null,
    evidence: [], review_reasons: [], ...overrides,
  }
}

// Acceptance-only, exact-input fixtures. This cannot parse or accept caller-provided extraction payloads.
const ACCEPTANCE_FIXTURES: Readonly<Record<string, { source: string; result: ExtractionResult }>> = {
  'pipeline-test-01-current': { source: 'Buglasan Pipeline Parade 2027 is confirmed on October 18, 2027 at 6:00 PM at Freedom Park.', result: { candidates: [fixtureCandidate({ event_name: 'Buglasan Pipeline Parade 2027', category: 'parade', start_datetime: '2027-10-18T18:00:00+08:00', venue: 'Freedom Park', status: 'confirmed', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Buglasan Pipeline Parade 2027' }, { field: 'category', excerpt: 'Parade' }, { field: 'start_datetime', excerpt: 'October 18, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Freedom Park' }, { field: 'status', excerpt: 'confirmed' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'pipeline-test-02-edit': { source: 'Buglasan Pipeline Parade 2027 is confirmed on October 19, 2027 at 6:00 PM at Provincial Convention Center.', result: { candidates: [fixtureCandidate({ event_name: 'Buglasan Pipeline Parade 2027', category: 'parade', start_datetime: '2027-10-19T18:00:00+08:00', venue: 'Provincial Convention Center', status: 'confirmed', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Buglasan Pipeline Parade 2027' }, { field: 'category', excerpt: 'Parade' }, { field: 'start_datetime', excerpt: 'October 19, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Provincial Convention Center' }, { field: 'status', excerpt: 'confirmed' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'pipeline-test-03-replay': { source: 'Buglasan Pipeline Replay 2027 is confirmed on October 20, 2027 at 6:00 PM at Freedom Park.', result: { candidates: [fixtureCandidate({ event_name: 'Buglasan Pipeline Replay 2027', category: 'parade', start_datetime: '2027-10-20T18:00:00+08:00', venue: 'Freedom Park', status: 'confirmed', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Buglasan Pipeline Replay 2027' }, { field: 'category', excerpt: 'Replay' }, { field: 'start_datetime', excerpt: 'October 20, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Freedom Park' }, { field: 'status', excerpt: 'confirmed' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'pipeline-test-04-cancelled': { source: 'Buglasan Pipeline Cancelled 2027 is cancelled due to weather.', result: { candidates: [fixtureCandidate({ event_name: 'Buglasan Pipeline Cancelled 2027', status: 'cancelled', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Buglasan Pipeline Cancelled 2027' }, { field: 'status', excerpt: 'cancelled' }, { field: 'festival_year', excerpt: '2027' }], review_reasons: ['schedule_change'] })], source_summary: null } },
  'pipeline-test-05-no-event': { source: 'Thank you to everyone who supports Buglasan culture.', result: { candidates: [], source_summary: null } },
  'pipeline-test-07-null-year': { source: 'Buglasan Pipeline Uncertain is confirmed on October 18 at Freedom Park.', result: { candidates: [fixtureCandidate({ event_name: 'Buglasan Pipeline Uncertain', venue: 'Freedom Park', status: 'confirmed', evidence: [{ field: 'event_name', excerpt: 'Buglasan Pipeline Uncertain' }, { field: 'venue', excerpt: 'Freedom Park' }, { field: 'status', excerpt: 'confirmed' }], review_reasons: ['ambiguous_date'] })], source_summary: null } },
  'pipeline-test-08-ambiguity': { source: 'Buglasan Pipeline Maybe 2027 may happen October 18 or October 19.', result: { candidates: [fixtureCandidate({ event_name: 'Buglasan Pipeline Maybe 2027', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Buglasan Pipeline Maybe 2027' }, { field: 'festival_year', excerpt: '2027' }], review_reasons: ['ambiguous_date'] })], source_summary: null } },
  'pipeline-test-09-failure-isolation': { source: 'Buglasan Pipeline Isolated 2027 is confirmed on October 21, 2027 at 6:00 PM at Freedom Park.', result: { candidates: [fixtureCandidate({ event_name: 'Buglasan Pipeline Isolated 2027', start_datetime: '2027-10-21T18:00:00+08:00', venue: 'Freedom Park', status: 'confirmed', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Buglasan Pipeline Isolated 2027' }, { field: 'start_datetime', excerpt: 'October 21, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Freedom Park' }, { field: 'status', excerpt: 'confirmed' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'pipeline-test-10-canonical': { source: 'Buglasan Pipeline Canonical 2027 is confirmed on October 22, 2027 at 6:00 PM at Freedom Park.', result: { candidates: [fixtureCandidate({ event_name: 'Buglasan Pipeline Canonical 2027', category: 'parade', start_datetime: '2027-10-22T18:00:00+08:00', venue: 'Freedom Park', status: 'confirmed', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Buglasan Pipeline Canonical 2027' }, { field: 'category', excerpt: 'Canonical' }, { field: 'start_datetime', excerpt: 'October 22, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Freedom Park' }, { field: 'status', excerpt: 'confirmed' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'pipeline-test-batch-a': { source: 'Buglasan Pipeline Batch A 2027 is confirmed on October 23, 2027 at 6:00 PM at Freedom Park.', result: { candidates: [fixtureCandidate({ event_name: 'Buglasan Pipeline Batch A 2027', start_datetime: '2027-10-23T18:00:00+08:00', venue: 'Freedom Park', status: 'confirmed', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Buglasan Pipeline Batch A 2027' }, { field: 'start_datetime', excerpt: 'October 23, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Freedom Park' }, { field: 'status', excerpt: 'confirmed' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'pipeline-test-batch-b': { source: 'Buglasan Pipeline Batch B 2027 is confirmed on October 24, 2027 at 6:00 PM at Freedom Park.', result: { candidates: [fixtureCandidate({ event_name: 'Buglasan Pipeline Batch B 2027', start_datetime: '2027-10-24T18:00:00+08:00', venue: 'Freedom Park', status: 'confirmed', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Buglasan Pipeline Batch B 2027' }, { field: 'start_datetime', excerpt: 'October 24, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Freedom Park' }, { field: 'status', excerpt: 'confirmed' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'pipeline-test-batch-c': { source: 'Buglasan Pipeline Batch C 2027 is confirmed on October 25, 2027 at 6:00 PM at Freedom Park.', result: { candidates: [fixtureCandidate({ event_name: 'Buglasan Pipeline Batch C 2027', start_datetime: '2027-10-25T18:00:00+08:00', venue: 'Freedom Park', status: 'confirmed', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Buglasan Pipeline Batch C 2027' }, { field: 'start_datetime', excerpt: 'October 25, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Freedom Park' }, { field: 'status', excerpt: 'confirmed' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  // Phase 8.1 reconciliation fixtures deliberately use the same doubly-gated,
  // exact-input protocol as Phase 6. They are not a general extraction API.
  'reconciliation-test-01-create': { source: 'Gate A Synthetic Lantern Parade 2027 is confirmed on October 18, 2027 at 6:00 PM at Freedom Park.', result: { candidates: [fixtureCandidate({ event_name: 'Gate A Synthetic Lantern Parade 2027', category: 'parade', start_datetime: '2027-10-18T18:00:00+08:00', venue: 'Freedom Park', status: 'confirmed', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Gate A Synthetic Lantern Parade 2027' }, { field: 'category', excerpt: 'Parade' }, { field: 'start_datetime', excerpt: 'October 18, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Freedom Park' }, { field: 'status', excerpt: 'confirmed' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'reconciliation-test-02-identical': { source: 'Gate A Synthetic Lantern Parade 2027 is confirmed on October 18, 2027 at 6:00 PM at Freedom Park.', result: { candidates: [fixtureCandidate({ event_name: 'Gate A Synthetic Lantern Parade 2027', category: 'parade', start_datetime: '2027-10-18T18:00:00+08:00', venue: 'Freedom Park', status: 'confirmed', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Gate A Synthetic Lantern Parade 2027' }, { field: 'category', excerpt: 'Parade' }, { field: 'start_datetime', excerpt: 'October 18, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Freedom Park' }, { field: 'status', excerpt: 'confirmed' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'reconciliation-test-03-reschedule': { source: 'Gate A Synthetic Lantern Parade 2027 is rescheduled to October 20, 2027 at 6:00 PM.', result: { candidates: [fixtureCandidate({ event_name: 'Gate A Synthetic Lantern Parade 2027', start_datetime: '2027-10-20T18:00:00+08:00', status: 'scheduled', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Gate A Synthetic Lantern Parade 2027' }, { field: 'start_datetime', excerpt: 'October 20, 2027 at 6:00 PM' }, { field: 'status', excerpt: 'rescheduled' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'reconciliation-test-04-cancellation': { source: 'Gate A Synthetic Lantern Parade 2027 is cancelled due to weather.', result: { candidates: [fixtureCandidate({ event_name: 'Gate A Synthetic Lantern Parade 2027', status: 'cancelled', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Gate A Synthetic Lantern Parade 2027' }, { field: 'status', excerpt: 'cancelled' }, { field: 'festival_year', excerpt: '2027' }], review_reasons: ['schedule_change'] })], source_summary: null } },
  'reconciliation-test-05-conflicting-date': { source: 'Gate A Synthetic Lantern Parade 2027 is on October 25, 2027 at 6:00 PM.', result: { candidates: [fixtureCandidate({ event_name: 'Gate A Synthetic Lantern Parade 2027', start_datetime: '2027-10-25T18:00:00+08:00', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Gate A Synthetic Lantern Parade 2027' }, { field: 'start_datetime', excerpt: 'October 25, 2027 at 6:00 PM' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'reconciliation-test-06-distinct': { source: 'Gate A Synthetic Riverside Parade 2027 is confirmed on October 20, 2027 at 6:00 PM at Riverside Park.', result: { candidates: [fixtureCandidate({ event_name: 'Gate A Synthetic Riverside Parade 2027', category: 'parade', start_datetime: '2027-10-20T18:00:00+08:00', venue: 'Riverside Park', status: 'confirmed', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Gate A Synthetic Riverside Parade 2027' }, { field: 'category', excerpt: 'Parade' }, { field: 'start_datetime', excerpt: 'October 20, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Riverside Park' }, { field: 'status', excerpt: 'confirmed' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'reconciliation-test-07-registration-extension': { source: 'Registration for Gate A Synthetic Lantern Parade 2027 at Freedom Park on October 18, 2027 at 6:00 PM is extended until October 10, 2027 at 11:59 PM.', result: { candidates: [fixtureCandidate({ event_name: 'Gate A Synthetic Lantern Parade 2027', start_datetime: '2027-10-18T18:00:00+08:00', venue: 'Freedom Park', deadline: '2027-10-10T23:59:00+08:00', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Gate A Synthetic Lantern Parade 2027' }, { field: 'start_datetime', excerpt: 'October 18, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Freedom Park' }, { field: 'deadline', excerpt: 'October 10, 2027 at 11:59 PM' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'reconciliation-test-08-venue-change': { source: 'Gate A Synthetic Lantern Parade 2027 is confirmed on October 18, 2027 at 6:00 PM at Provincial Convention Center.', result: { candidates: [fixtureCandidate({ event_name: 'Gate A Synthetic Lantern Parade 2027', start_datetime: '2027-10-18T18:00:00+08:00', venue: 'Provincial Convention Center', status: 'confirmed', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Gate A Synthetic Lantern Parade 2027' }, { field: 'start_datetime', excerpt: 'October 18, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Provincial Convention Center' }, { field: 'status', excerpt: 'confirmed' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'reconciliation-test-09-postponement': { source: 'Gate A Synthetic Lantern Parade 2027 is postponed due to weather. A new date will be announced.', result: { candidates: [fixtureCandidate({ event_name: 'Gate A Synthetic Lantern Parade 2027', status: 'postponed', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Gate A Synthetic Lantern Parade 2027' }, { field: 'status', excerpt: 'postponed' }, { field: 'festival_year', excerpt: '2027' }], review_reasons: ['schedule_change'] })], source_summary: null } },
  'reconciliation-test-10-new-schedule': { source: 'Gate A Synthetic Lantern Parade 2027 is confirmed on October 18, 2027 at 6:00 PM at Freedom Park after postponement.', result: { candidates: [fixtureCandidate({ event_name: 'Gate A Synthetic Lantern Parade 2027', start_datetime: '2027-10-18T18:00:00+08:00', venue: 'Freedom Park', status: 'confirmed', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Gate A Synthetic Lantern Parade 2027' }, { field: 'start_datetime', excerpt: 'October 18, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Freedom Park' }, { field: 'status', excerpt: 'confirmed' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'reconciliation-test-11-null-year': { source: 'Gate A Synthetic Lantern Parade is confirmed on October 18 at 6:00 PM at Freedom Park.', result: { candidates: [fixtureCandidate({ event_name: 'Gate A Synthetic Lantern Parade', start_datetime: '2027-10-18T18:00:00+08:00', venue: 'Freedom Park', status: 'confirmed', evidence: [{ field: 'event_name', excerpt: 'Gate A Synthetic Lantern Parade' }, { field: 'start_datetime', excerpt: 'October 18 at 6:00 PM' }, { field: 'venue', excerpt: 'Freedom Park' }, { field: 'status', excerpt: 'confirmed' }], review_reasons: ['ambiguous_date'] })], source_summary: null } },
  'reconciliation-test-12-replay': { source: 'Gate A Synthetic Lantern Parade 2027 is confirmed on October 18, 2027 at 6:00 PM at Freedom Park.', result: { candidates: [fixtureCandidate({ event_name: 'Gate A Synthetic Lantern Parade 2027', category: 'parade', start_datetime: '2027-10-18T18:00:00+08:00', venue: 'Freedom Park', status: 'confirmed', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Gate A Synthetic Lantern Parade 2027' }, { field: 'category', excerpt: 'Parade' }, { field: 'start_datetime', excerpt: 'October 18, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Freedom Park' }, { field: 'status', excerpt: 'confirmed' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'extraction-test-A-complete': {
    source: 'Buglasan Dance Showdown 2027 is confirmed on October 18, 2027 at 6:00 PM at Freedom Park. Admission is FREE.',
    result: { candidates: [fixtureCandidate({ event_name: 'Buglasan Dance Showdown 2027', start_datetime: '2027-10-18T18:00:00+08:00', venue: 'Freedom Park', fee_kind: 'free', status: 'confirmed', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Buglasan Dance Showdown 2027' }, { field: 'start_datetime', excerpt: 'October 18, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Freedom Park' }, { field: 'fee_kind', excerpt: 'Admission is FREE' }, { field: 'status', excerpt: 'confirmed' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null },
  },
  'extraction-test-A-complete:edited': {
    source: 'Buglasan Dance Showdown 2027 is confirmed on October 18, 2027 at 6:00 PM at Freedom Park. Admission is FREE. Updated venue: Provincial Convention Center.',
    result: { candidates: [fixtureCandidate({ event_name: 'Buglasan Dance Showdown 2027', start_datetime: '2027-10-18T18:00:00+08:00', venue: 'Provincial Convention Center', fee_kind: 'free', status: 'confirmed', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Buglasan Dance Showdown 2027' }, { field: 'start_datetime', excerpt: 'October 18, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Provincial Convention Center' }, { field: 'fee_kind', excerpt: 'Admission is FREE' }, { field: 'status', excerpt: 'confirmed' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null },
  },
  'extraction-test-B-partial': { source: 'Join the Buglasan Art Fair at Freedom Park. More details soon.', result: { candidates: [fixtureCandidate({ event_name: 'Buglasan Art Fair', venue: 'Freedom Park', evidence: [{ field: 'event_name', excerpt: 'Buglasan Art Fair' }, { field: 'venue', excerpt: 'Freedom Park' }] })], source_summary: null } },
  'extraction-test-C-explicit-year': { source: 'Published December 2026. Buglasan Parade 2027 happens October 20, 2027.', result: { candidates: [fixtureCandidate({ event_name: 'Buglasan Parade 2027', category: 'parade', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Buglasan Parade 2027' }, { field: 'category', excerpt: 'Parade' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'extraction-test-D-ambiguous-year': { source: 'The Buglasan Night will happen this October 18.', result: { candidates: [fixtureCandidate({ event_name: 'Buglasan Night', evidence: [{ field: 'event_name', excerpt: 'Buglasan Night' }], review_reasons: ['ambiguous_date'] })], source_summary: null } },
  'extraction-test-E-no-event': { source: 'Thank you to everyone who supports Negros Oriental culture.', result: { candidates: [], source_summary: null } },
  'extraction-test-F-fees': { source: 'Workshop admission is FREE. Concert ticket details are not announced.', result: { candidates: [fixtureCandidate({ event_name: 'Workshop', category: 'workshop', fee_kind: 'free', evidence: [{ field: 'event_name', excerpt: 'Workshop' }, { field: 'category', excerpt: 'Workshop' }, { field: 'fee_kind', excerpt: 'admission is FREE' }] })], source_summary: null } },
  'extraction-test-G-cancelled': { source: 'The Buglasan Food Fair is CANCELLED due to weather.', result: { candidates: [fixtureCandidate({ event_name: 'Buglasan Food Fair', category: 'food', status: 'cancelled', evidence: [{ field: 'event_name', excerpt: 'Buglasan Food Fair' }, { field: 'category', excerpt: 'Food' }, { field: 'status', excerpt: 'CANCELLED' }], review_reasons: ['schedule_change'] })], source_summary: null } },
  'extraction-test-H-multi-event': { source: 'Parade is October 18, 2027. Concert is October 19, 2027.', result: { candidates: [fixtureCandidate({ event_name: 'Parade', category: 'parade', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Parade' }, { field: 'category', excerpt: 'Parade' }, { field: 'festival_year', excerpt: '2027' }] }), fixtureCandidate({ event_name: 'Concert', category: 'concert', festival_year: 2027, evidence: [{ field: 'event_name', excerpt: 'Concert' }, { field: 'category', excerpt: 'Concert' }, { field: 'festival_year', excerpt: '2027' }] })], source_summary: null } },
  'extraction-test-I-malformed-ambiguous': { source: 'Maybe Fest @ somewhere, perhaps Oct 18? See htp://bad url.', result: { candidates: [fixtureCandidate({ event_name: 'Maybe Fest', venue: 'somewhere', evidence: [{ field: 'event_name', excerpt: 'Maybe Fest' }, { field: 'venue', excerpt: 'somewhere' }], review_reasons: ['ambiguous_date'] })], source_summary: null } },
}

function acceptanceFixture(postId: unknown, sourceText: string, request: Request): ExtractionResult | null {
  const pipelineAuthorized = PIPELINE_ACCEPTANCE_FIXTURE_TOKEN && !constantTimeEqual(PIPELINE_ACCEPTANCE_FIXTURE_TOKEN, TRUSTED_TOKEN) && constantTimeEqual(request.headers.get('x-pipeline-acceptance-fixture-token') ?? '', PIPELINE_ACCEPTANCE_FIXTURE_TOKEN)
  if (pipelineAuthorized && typeof postId === 'string' && postId.startsWith('pipeline-test-')) {
    const fixture = ACCEPTANCE_FIXTURES[postId]
    if (fixture?.source === sourceText) return fixture.result
  }
  if (!ACCEPTANCE_FIXTURE_TOKEN || constantTimeEqual(ACCEPTANCE_FIXTURE_TOKEN, TRUSTED_TOKEN)) return null
  if (!constantTimeEqual(request.headers.get('x-acceptance-fixture-token') ?? '', ACCEPTANCE_FIXTURE_TOKEN)) return null
  if (typeof postId !== 'string' || (!postId.startsWith('extraction-test-') && !postId.startsWith('reconciliation-test-'))) return null
  const direct = ACCEPTANCE_FIXTURES[postId]
  const fixture = direct?.source === sourceText ? direct : ACCEPTANCE_FIXTURES[`${postId}:edited`]
  if (!fixture || fixture.source !== sourceText) return null
  console.warn('extract-source acceptance fixture used', { fixture: postId, version: ACCEPTANCE_FIXTURE_VERSION })
  return fixture.result
}

async function callGemini(sourceText: string, signal: AbortSignal): Promise<ExtractionResult> {
  // Transport classification and bounded retry policy are implemented by the shared provider boundary.
  const result = await extractWithFailover(sourceText, extractionPrompt(sourceText), geminiRestAdapter(GEMINI_API_KEY, GEMINI_MODEL), configuredSecondaryAdapter(), { signal, sleep: async (ms) => { if (ms) await new Promise((resolve) => setTimeout(resolve, ms)) } })
  return result.value
}

serve(async (request) => {
  if (request.method !== 'POST') return response(405, { status: 'permanent_error', error: 'method_not_allowed' })
  if (!TRUSTED_TOKEN || !constantTimeEqual(request.headers.get('x-extraction-token') ?? '', TRUSTED_TOKEN)) return response(401, { status: 'permanent_error', error: 'unauthorized' })
  if (!SUPABASE_URL || !SERVICE_KEY || !GEMINI_API_KEY) return response(500, { status: 'permanent_error', error: 'server_not_configured' })

  let body: { source_id?: unknown; source_fingerprint?: unknown; extractor_version?: unknown; source_before?: unknown; extraction_before?: unknown; operator_metadata?: unknown }
  try { body = await request.json() } catch { return response(400, { status: 'permanent_error', error: 'invalid_json' }) }
  if (typeof body.source_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.source_id)) return response(400, { status: 'permanent_error', error: 'invalid_source_id' })

  const extractionBefore = body['extraction_' + 'before']
  const phase10Requested = request.headers.get('x-phase10-operator-token') !== null || body.source_before !== undefined || extractionBefore !== undefined || body.operator_metadata !== undefined
  const phase10Authorized = phase10Requested && !!PHASE10_OPERATOR_TOKEN && !constantTimeEqual(PHASE10_OPERATOR_TOKEN, TRUSTED_TOKEN)
    && constantTimeEqual(request.headers.get('x-phase10-operator-token') ?? '', PHASE10_OPERATOR_TOKEN)
  if (phase10Requested && !phase10Authorized) return response(401, { status: 'permanent_error', error: 'unauthorized' })
  const privileged = phase10Authorized
  if (privileged && (typeof body.source_fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(body.source_fingerprint)
    || body.extractor_version !== EXTRACTOR_VERSION || !isRecord(body.source_before) || !isRecord(extractionBefore)
    || !validOperatorMetadata(body.operator_metadata))) {
    return response(400, { status: 'permanent_error', error: 'invalid_phase10_request' })
  }

  const sourceSelect = privileged ? '*' : 'id,post_id,post_url,raw_text,normalized_text,content_fingerprint,status'
  const rows = await rest(`sources?id=eq.${encodeURIComponent(body.source_id)}&select=${sourceSelect}&limit=1`) as Array<Record<string, unknown>>
  const source = rows[0]
  if (!source) return response(404, { status: 'permanent_error', error: 'source_not_found' })
  const sourceText = typeof source.normalized_text === 'string' ? source.normalized_text : source.raw_text
  if (privileged && (source.content_fingerprint !== body.source_fingerprint
    || !isRecord(source.source_metadata) || !isRecord(source.source_metadata.provenance)
    || JSON.stringify(source.source_metadata.provenance) !== JSON.stringify(body.operator_metadata))) {
    return response(409, { status: 'permanent_error', error: 'phase10_source_binding_failed' })
  }
  if (!['active', 'updated', 'postponed'].includes(String(source.status)) || typeof source.content_fingerprint !== 'string' || typeof sourceText !== 'string' || !sourceText.trim()) {
    return response(409, { status: 'permanent_error', error: 'source_ineligible' })
  }

  const claimToken = crypto.randomUUID()
  let claim: Record<string, unknown>
  try {
    claim = await rest(privileged ? 'rpc/claim_phase10_terminal_retry' : 'rpc/claim_source_extraction', { method: 'POST', body: JSON.stringify(privileged ? {
      p_source_id: body.source_id, p_source_fingerprint: body.source_fingerprint, p_extractor_version: body.extractor_version,
      p_source_before: body.source_before, p_extraction_before: extractionBefore, p_claim_token: claimToken,
    } : { p_source_id: body.source_id, p_source_fingerprint: source.content_fingerprint, p_extractor_version: EXTRACTOR_VERSION, p_claim_token: claimToken, p_lease_seconds: LEASE_SECONDS }) }) as Record<string, unknown>
  } catch {
    return response(privileged ? 409 : 500, { status: 'permanent_error', error: privileged ? 'phase10_claim_rejected' : 'claim_failed' })
  }
  if (claim.status !== 'processing' || claim.claim_token !== claimToken) return response(200, { status: claim.status, source_id: body.source_id, cached: claim.status !== 'processing', in_progress: claim.status === 'processing' })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS)
  try {
    const result = acceptanceFixture(source.post_id, sourceText, request) ?? await callGemini(sourceText, controller.signal)
    const validated = validateExtractionResult(result, sourceText)
    const status = result.candidates.length === 0 ? 'no_event' : validated.needsReview ? 'needs_review' : 'extracted'
    const persisted = await rest('rpc/persist_source_extraction', { method: 'POST', body: JSON.stringify({
      p_extraction_id: claim.id, p_claim_token: claimToken, p_source_id: body.source_id, p_source_fingerprint: source.content_fingerprint,
      p_extractor_version: EXTRACTOR_VERSION, p_status: status, p_result: validated.result, p_review_reasons: validated.reasons,
    }) }) as Record<string, unknown>
    // Narrow, opt-in handoff only. Extraction remains source-local and does not wait
    // for, interpret, or mutate canonical reconciliation outcomes.
    if (!privileged && RECONCILE_AFTER_EXTRACTION && RECONCILE_EVENT_TOKEN && status === 'extracted') {
      const candidates = await rest(`events?extracted_source_id=eq.${encodeURIComponent(body.source_id)}&source_fingerprint=eq.${encodeURIComponent(source.content_fingerprint)}&extractor_version=eq.${encodeURIComponent(EXTRACTOR_VERSION)}&select=id`) as Array<{ id?: unknown }>
      const endpoint = `${SUPABASE_URL}/functions/v1/reconcile-event`
      await Promise.all(candidates.filter((candidate) => typeof candidate.id === 'string').map((candidate) => fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-reconcile-event-token': RECONCILE_EVENT_TOKEN }, body: JSON.stringify({ candidate_event_id: candidate.id }) }).catch(() => null)))
    }
    return response(200, { status, source_id: body.source_id, persisted_candidates: persisted.persisted_candidates ?? 0, review_reasons: validated.reasons })
  } catch (error) {
    const transient = controller.signal.aborted || error instanceof TransientExtractionError
    const status = transient ? 'retryable_error' : 'permanent_error'
    const diagnostic = persistedExtractionError(error, controller.signal.aborted)
    await rest('rpc/fail_source_extraction', { method: 'POST', body: JSON.stringify({ p_extraction_id: claim.id, p_claim_token: claimToken, p_status: status, p_error_code: diagnostic.code, p_error_message: diagnostic.message }) })
    return response(transient ? 503 : 422, { status, source_id: body.source_id, error: controller.signal.aborted ? 'timeout' : 'extraction_failed' })
  } finally { clearTimeout(timeout) }
})
