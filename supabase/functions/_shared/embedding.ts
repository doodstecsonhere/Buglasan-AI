export const EMBEDDING_DIMENSIONS = 768
export const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001'

export type EmbeddingFailureStatus = 'retryable_error' | 'permanent_error'
export class EmbeddingFailure extends Error {
  constructor(
    public readonly status: EmbeddingFailureStatus,
    public readonly code: string,
    public readonly safeMessage: string,
    public readonly httpStatus?: number,
  ) {
    super(safeMessage)
    this.name = 'EmbeddingFailure'
  }
}

export interface EmbeddingOptions {
  apiKey: string
  model?: string
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
  timeoutMs?: number
  attempts?: number
  batchSize?: number
  sleep?: (milliseconds: number) => Promise<void>
}

export function normalizeEmbedding(values: unknown, expectedDimensions = EMBEDDING_DIMENSIONS): number[] {
  if (!Array.isArray(values) || values.length !== expectedDimensions) {
    throw new EmbeddingFailure('permanent_error', 'embedding_dimension_mismatch', 'Embedding dimensions do not match the configured contract', 422)
  }
  let sum = 0
  let compensation = 0
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new EmbeddingFailure('permanent_error', 'embedding_non_finite', 'Embedding contains a non-finite value', 422)
    }
    const square = value * value
    const adjusted = square - compensation
    const next = sum + adjusted
    compensation = (next - sum) - adjusted
    sum = next
  }
  const norm = Math.sqrt(sum)
  if (!Number.isFinite(norm) || norm === 0) {
    throw new EmbeddingFailure('permanent_error', 'embedding_zero_vector', 'Embedding has zero magnitude', 422)
  }
  const normalized = (values as number[]).map((value) => value / norm)
  const check = Math.sqrt(normalized.reduce((total, value) => total + value * value, 0))
  if (normalized.some((value) => !Number.isFinite(value)) || Math.abs(check - 1) > 1e-5) {
    throw new EmbeddingFailure('permanent_error', 'embedding_non_finite', 'Embedding normalization failed', 422)
  }
  return normalized
}

export function classifyEmbeddingError(error: unknown): EmbeddingFailure {
  if (error instanceof EmbeddingFailure) return error
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new EmbeddingFailure('retryable_error', 'embedding_timeout', 'Embedding request timed out', 503)
  }
  if (error instanceof TypeError) {
    return new EmbeddingFailure('retryable_error', 'embedding_network_error', 'Embedding provider network error', 503)
  }
  return new EmbeddingFailure('permanent_error', 'embedding_malformed_response', 'Embedding provider returned an invalid response', 422)
}

function classifyHttp(status: number): EmbeddingFailure {
  if (status === 429) return new EmbeddingFailure('retryable_error', 'embedding_rate_limited', 'Embedding provider rate limited the request', 503)
  if ([500, 502, 503, 504].includes(status)) return new EmbeddingFailure('retryable_error', 'embedding_upstream_unavailable', 'Embedding provider is unavailable', 503)
  if (status === 400) return new EmbeddingFailure('permanent_error', 'embedding_bad_request', 'Embedding provider rejected the request', 422)
  if (status === 401 || status === 403) return new EmbeddingFailure('permanent_error', 'embedding_auth_error', 'Embedding provider authentication failed', 422)
  if (status === 404) return new EmbeddingFailure('permanent_error', 'embedding_model_not_found', 'Embedding model was not found', 422)
  if (status >= 400 && status < 500) return new EmbeddingFailure('permanent_error', 'embedding_request_rejected', 'Embedding provider rejected the request', 422)
  return new EmbeddingFailure('permanent_error', 'embedding_unclassified_http', 'Embedding provider failed', 422)
}

async function requestEmbedding(text: string, taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT', options: EmbeddingOptions): Promise<number[]> {
  const fetcher = options.fetch ?? globalThis.fetch
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL
  const attempts = options.attempts ?? 3
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000)
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent?key=${encodeURIComponent(options.apiKey)}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text }] }, taskType, outputDimensionality: EMBEDDING_DIMENSIONS }),
        })
        if (!response.ok) throw classifyHttp(response.status)
        const body = await response.json()
        return normalizeEmbedding(body?.embedding?.values ?? body?.embeddings?.[0]?.values)
      } catch (error) {
        const failure = classifyEmbeddingError(error)
        if (failure.status !== 'retryable_error' || attempt === attempts || controller.signal.aborted) throw failure
        await sleep(attempt === 1 ? 250 : 500)
      }
    }
    throw new EmbeddingFailure('retryable_error', 'embedding_upstream_unavailable', 'Embedding provider is unavailable', 503)
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

export async function generateQueryEmbedding(text: string, options: EmbeddingOptions): Promise<number[]> {
  if (!text.trim()) throw new EmbeddingFailure('permanent_error', 'embedding_bad_request', 'Embedding text must not be blank', 422)
  return requestEmbedding(text, 'RETRIEVAL_QUERY', options)
}

export async function generateDocumentEmbeddings(texts: string[], options: EmbeddingOptions): Promise<number[][]> {
  if (!Array.isArray(texts) || texts.length === 0 || texts.some((text) => typeof text !== 'string' || !text.trim())) {
    throw new EmbeddingFailure('permanent_error', 'embedding_bad_request', 'Embedding documents must not be empty or blank', 422)
  }
  const output: number[][] = []
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 20, 20))
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    for (const text of texts.slice(offset, offset + batchSize)) output.push(await requestEmbedding(text, 'RETRIEVAL_DOCUMENT', options))
  }
  return output
}
