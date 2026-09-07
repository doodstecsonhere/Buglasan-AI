export interface GenerationFailure {
  stage: 'answer_generation'
  errorName?: string
  errorCode?: string | number
  httpStatus?: number
  providerStatus?: string
  retryable?: boolean
  causeName?: string
  transportKind?: string
  messageCategory: string
}

function recordOf(error: unknown): Record<string, unknown> | undefined {
  return error && typeof error === 'object' ? error as Record<string, unknown> : undefined
}

function numericProperty(record: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record?.[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function stringProperty(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record?.[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function safeCode(record: Record<string, unknown> | undefined): string | number | undefined {
  const value = record?.code
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? value : undefined
}

export function classifyGenerationMessage(message: string, status?: number): { category: string; transportKind?: string } {
  const lower = message.toLowerCase()
  if (status === 429 || lower.includes('429') || lower.includes('rate limit') || lower.includes('quota')) return { category: 'rate_limited' }
  if (status === 401 || lower.includes('api key') || lower.includes('authentication') || lower.includes('unauthorized')) return { category: 'authentication_rejected' }
  if (status === 403 || lower.includes('permission') || lower.includes('forbidden')) return { category: 'permission_denied' }
  if (status === 404 || lower.includes('not found') || lower.includes('model not found')) return { category: 'model_not_found' }
  if (status === 400 || lower.includes('invalid argument') || lower.includes('invalid request')) return { category: 'invalid_request' }
  if (status === 500 || lower.includes(' 500') || lower.includes('internal server')) return { category: 'upstream_500', transportKind: 'provider_http' }
  if (status === 502 || lower.includes(' 502')) return { category: 'upstream_502', transportKind: 'provider_http' }
  if (status === 503 || lower.includes(' 503') || lower.includes('service unavailable')) return { category: 'upstream_503', transportKind: 'provider_http' }
  if (status === 504 || lower.includes(' 504') || lower.includes('gateway timeout')) return { category: 'upstream_504', transportKind: 'provider_http' }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('aborterror')) return { category: 'timeout' }
  if (lower.includes('dns') || lower.includes('enotfound')) return { category: 'dns_failure', transportKind: 'dns' }
  if (lower.includes('connection reset') || lower.includes('econnreset')) return { category: 'connection_reset', transportKind: 'connection' }
  if (lower.includes('connection refused') || lower.includes('econnrefused')) return { category: 'connection_failure', transportKind: 'connection' }
  if (lower.includes('fetch failed') || lower.includes('network') || lower.includes('tls')) return { category: 'fetch_failed', transportKind: 'network' }
  return { category: 'unknown_provider_error' }
}

export function getGenerationFailure(error: unknown): GenerationFailure {
  const record = recordOf(error)
  const status = numericProperty(record, ['status', 'statusCode', 'httpStatus'])
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const classification = classifyGenerationMessage(message, status)
  const failure: GenerationFailure = {
    stage: 'answer_generation',
    messageCategory: classification.category,
  }
  const name = stringProperty(record, ['name'])
  const code = safeCode(record)
  const providerStatus = stringProperty(record, ['statusText', 'providerStatus', 'status'])
  const cause = record?.cause
  const causeName = cause && typeof cause === 'object' ? stringProperty(cause as Record<string, unknown>, ['name']) : undefined
  const retryable = typeof record?.retryable === 'boolean' ? record.retryable : undefined
  if (name) failure.errorName = name
  if (code !== undefined) failure.errorCode = code
  if (status !== undefined) failure.httpStatus = status
  if (providerStatus && providerStatus !== String(status)) failure.providerStatus = providerStatus
  if (retryable !== undefined) failure.retryable = retryable
  if (causeName) failure.causeName = causeName
  if (classification.transportKind) failure.transportKind = classification.transportKind
  return failure
}
