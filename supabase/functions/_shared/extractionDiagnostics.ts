// Deterministic extraction failure classification shared by the extract-source
// Edge Function and its vitest coverage. This module must stay Deno-free so it
// is directly testable in Node. It maps materially different failures to
// distinct, diagnosable error codes + bounded sanitized messages, and only keeps
// extraction_unknown_failure as a true unknown fallback.
import { isFailoverEligible } from './providerErrors.ts'
import type { ExtractionDiagnosticCode } from './providerTypes.ts'

interface ProviderFailureLike extends Error {
  name: 'ProviderError'
  provider: unknown
  category: unknown
  status?: unknown
  diagnostic?: unknown
  attemptCount?: unknown
  failoverFailures?: unknown
}

export type ExtractionFailureStage = 'provider' | 'validation' | 'persist'

export interface ExtractionFailureReport {
  code: string
  message: string
  retryable: boolean
}

// Categories that remain transient after every provider attempt is exhausted:
// these were the systemic collapse into extraction_unknown_failure.
const TRANSIENT_CATEGORIES = [
  'rate_limited', 'upstream_500', 'upstream_502', 'upstream_503', 'upstream_504',
  'timeout', 'dns_failure', 'connection_reset', 'connection_failure', 'fetch_failed',
] as const

// Post-provider persistence failures with these HTTP statuses stay retryable,
// preserving the legacy retryable_error outcome for database 5xx/429/408.
const TRANSIENT_PERSIST_STATUSES = [408, 425, 429, 500, 502, 503, 504]

// Non-secret diagnostic label for an ExtractionDiagnosticError kind.
const DIAGNOSTIC_KINDS: readonly ExtractionDiagnosticCode[] = ['malformed_json', 'invalid_structure', 'invalid_content', 'nonretryable_provider', 'unknown_failure']

function asProviderErrorLike(error: unknown): ProviderFailureLike | null {
  if (!(error instanceof Error) || error.name !== 'ProviderError' || !('category' in error)) return null
  return error as ProviderFailureLike
}

// Name-based like providerFailover.test.ts: resilient to Deno/vitest dual module graphs.
function asDiagnosticErrorLike(error: unknown): { diagnostic: ExtractionDiagnosticCode } | null {
  if (!(error instanceof Error) || error.name !== 'ExtractionDiagnosticError') return null
  const candidate = error as Error & { diagnostic?: unknown }
  return DIAGNOSTIC_KINDS.includes(candidate.diagnostic as ExtractionDiagnosticCode) ? { diagnostic: candidate.diagnostic as ExtractionDiagnosticCode } : null
}

/** Bounded single-line sanitization: strip URLs, bearer tokens and key=value secrets before persistence. */
export function sanitizeDiagnosticText(value: unknown, limit = 300): string {
  const raw = value instanceof Error ? `${value.name}: ${value.message}` : String(value ?? '')
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\bhttps?:\/\/\S+/gi, '[url]')
    .replace(/\bbearer\s+\S+/gi, 'bearer [redacted]')
    .replace(/\b[A-Za-z][A-Za-z0-9_]*(?:api)?key\b\s*[=:]\s*\S+/gi, (match) => `${match.split(/[=:]/)[0].trim()}=[redacted]`)
    .trim()
    .slice(0, limit)
}

function parsePersistStatus(message: string): number | null {
  const match = /database (\d{3})/.exec(message)
  return match ? Number(match[1]) : null
}

function failoverContext(error: ProviderFailureLike): Record<string, unknown> | undefined {
  if (typeof error.attemptCount !== 'number') return undefined
  const failures = Array.isArray(error.failoverFailures) ? error.failoverFailures.map((item: unknown) => sanitizeDiagnosticText(item, 48)).slice(0, 12) : []
  return { attempts: error.attemptCount, failures }
}

/**
 * Maps any thrown value from the extraction request pipeline to a persisted
 * error code, a retryability outcome and a bounded sanitized diagnostic.
 * Known transient provider failures never collapse into extraction_unknown_failure.
 */
export function describeExtractionFailure(error: unknown, timedOut: boolean, stage: ExtractionFailureStage): ExtractionFailureReport {
  if (timedOut) return { code: 'extraction_timeout', message: 'extraction failed', retryable: true }

  const provider = asProviderErrorLike(error)
  if (provider) {
    const category = String(provider.category)
    const status = typeof provider.status === 'number' ? provider.status : undefined
    const diagnostic = DIAGNOSTIC_KINDS.includes(provider.diagnostic as ExtractionDiagnosticCode) ? String(provider.diagnostic) : undefined
    const retryable = isFailoverEligible(provider)
    if (diagnostic) return { code: `extraction_${diagnostic}`, message: 'extraction failed', retryable }
    if (TRANSIENT_CATEGORIES.includes(category as (typeof TRANSIENT_CATEGORIES)[number])) {
      return { code: `extraction_provider_${category}`, message: 'extraction failed', retryable: true }
    }
    const detail: Record<string, unknown> = { stage: 'provider', category, provider: String(provider.provider) }
    if (status !== undefined) detail.httpStatus = status
    const context = failoverContext(provider)
    if (context) detail.failover = context
    return {
      code: retryable ? 'extraction_provider_transient' : 'extraction_nonretryable_provider',
      message: `extraction failed: ${JSON.stringify(detail)}`,
      retryable,
    }
  }

  const diagnosticError = asDiagnosticErrorLike(error)
  if (diagnosticError) {
    return { code: `extraction_${diagnosticError.diagnostic}`, message: 'extraction failed', retryable: false }
  }

  const message = error instanceof Error ? error.message : String(error)
  if (/provider operation aborted|AbortError|signal aborted/i.test(message)) {
    return { code: 'extraction_aborted', message: 'extraction failed', retryable: true }
  }

  if (stage === 'validation' || stage === 'persist') {
    // Anything surfacing after the provider call succeeded is a post-provider
    // (persistence/runtime) failure, distinguishable from provider execution.
    const httpStatus = parsePersistStatus(message)
    const detail: Record<string, unknown> = { stage: 'persistence' }
    if (httpStatus !== null) detail.httpStatus = httpStatus
    const reason = sanitizeDiagnosticText(message, 160)
    if (reason) detail.reason = reason
    const retryable = httpStatus === null ? true : TRANSIENT_PERSIST_STATUSES.includes(httpStatus)
    return {
      code: retryable ? 'extraction_persistence_transient' : 'extraction_persistence_permanent',
      message: `extraction failed: ${JSON.stringify(detail)}`,
      retryable,
    }
  }

  // Genuine provider-stage surprises only (e.g. programmer errors in the
  // request pipeline). Retain the legacy retryable_error outcome unchanged.
  return { code: 'extraction_unknown_failure', message: 'extraction failed', retryable: true }
}
