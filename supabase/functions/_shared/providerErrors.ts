import type { ProviderFailureCategory, ProviderName } from './providerTypes.ts'

export class ProviderError extends Error {
  readonly provider: ProviderName
  readonly category: ProviderFailureCategory
  readonly status?: number
  constructor(provider: ProviderName, category: ProviderFailureCategory, message: string, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.provider = provider
    this.category = category
    this.status = status
  }
}

export function isFailoverEligible(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false
  return ['rate_limited', 'upstream_500', 'upstream_502', 'upstream_503', 'upstream_504', 'timeout', 'dns_failure', 'connection_reset', 'connection_failure', 'fetch_failed'].includes(error.category)
}

export function safeProviderError(error: unknown): Record<string, unknown> {
  if (error instanceof ProviderError) return { provider: error.provider, category: error.category, httpStatus: error.status }
  return { category: 'unknown_provider_error' }
}

export function classifyHttpStatus(status: number): ProviderFailureCategory {
  if (status === 429) return 'rate_limited'
  if (status === 500) return 'upstream_500'
  if (status === 502) return 'upstream_502'
  if (status === 503) return 'upstream_503'
  if (status === 504) return 'upstream_504'
  if (status === 401) return 'authentication_rejected'
  if (status === 403) return 'permission_denied'
  if (status === 404) return 'model_not_found'
  if (status === 400) return 'invalid_request'
  return 'unknown_provider_error'
}

export function classifyTransport(error: unknown): ProviderFailureCategory {
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown } | null
  if (typeof candidate?.status === 'number') return classifyHttpStatus(candidate.status)
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (message.includes('invalid') || message.includes('bad request') || message.includes('configuration')) return 'invalid_request'
  if (message.includes('api key') || message.includes('unauthorized') || message.includes('authentication')) return 'authentication_rejected'
  if (message.includes('forbidden') || message.includes('permission')) return 'permission_denied'
  if (message.includes('model') && (message.includes('not found') || message.includes('invalid') || message.includes('does not exist'))) return 'model_not_found'
  if (message.includes('timeout') || message.includes('abort')) return 'timeout'
  if (message.includes('dns') || message.includes('enotfound')) return 'dns_failure'
  if (message.includes('econnreset') || message.includes('connection reset')) return 'connection_reset'
  if (message.includes('econnrefused') || message.includes('connection refused')) return 'connection_failure'
  return 'fetch_failed'
}
