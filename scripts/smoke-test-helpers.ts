export const EMBEDDING_DIMENSION = 768
export const LIVE_OPT_IN = 'I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION'
export const SMOKE_PREFIX = 'smoke-test-'

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function normalizeEmbedding(values: unknown): number[] {
  assert(Array.isArray(values), 'Embedding must be an array')
  assert(values.length === EMBEDDING_DIMENSION, `Embedding must contain exactly ${EMBEDDING_DIMENSION} values`)
  const vector = values.map((value, index) => {
    assert(typeof value === 'number' && Number.isFinite(value), `Embedding value ${index} must be finite`)
    return value
  })
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  assert(Number.isFinite(magnitude) && magnitude > 0, 'Embedding must have non-zero finite magnitude')
  const normalized = vector.map((value) => value / magnitude)
  const norm = Math.sqrt(normalized.reduce((sum, value) => sum + value * value, 0))
  assert(Math.abs(norm - 1) <= 1e-10, `Normalized embedding norm must be 1 (received ${norm})`)
  return normalized
}

export function projectRefFromUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTPS URL')
  }
  assert(url.protocol === 'https:', 'SUPABASE_URL must use HTTPS')
  const match = url.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i)
  assert(match, 'SUPABASE_URL must be a hosted *.supabase.co URL')
  return match[1]
}

export function assertLiveSafety(env: NodeJS.ProcessEnv): { projectRef: string } {
  assert(env.LIVE_RAG_SMOKE_TEST === LIVE_OPT_IN, `Set LIVE_RAG_SMOKE_TEST exactly to ${LIVE_OPT_IN}`)
  assert(env.SUPABASE_URL, 'SUPABASE_URL is required')
  assert(env.SUPABASE_EXPECTED_PROJECT_REF, 'SUPABASE_EXPECTED_PROJECT_REF is required')
  const projectRef = projectRefFromUrl(env.SUPABASE_URL)
  assert(projectRef === env.SUPABASE_EXPECTED_PROJECT_REF, 'SUPABASE_URL does not match SUPABASE_EXPECTED_PROJECT_REF')
  return { projectRef }
}

export function assertOnlyYear(rows: unknown[], expectedYear: number, label: string): void {
  for (const row of rows) {
    assert(row !== null && typeof row === 'object', `${label} contains a non-object row`)
    const value = row as Record<string, unknown>
    const year = value.festival_year ?? value.source_festival_year ?? value.festivalYear
    assert(year === expectedYear, `${label} cross-year contamination: expected ${expectedYear}, received ${String(year)}`)
  }
}

export function extractCitations(response: Record<string, unknown>): Array<Record<string, unknown>> {
  const message = response.message
  if (!message || typeof message !== 'object') return []
  const sources = (message as Record<string, unknown>).sources
  return Array.isArray(sources) ? sources.filter((value): value is Record<string, unknown> => !!value && typeof value === 'object') : []
}

export function assertAcceptanceAnswer(
  content: string,
  expectedYear: 2025 | 2026,
  mode: 'fixture' | 'unavailable',
): void {
  assert(new RegExp(`\\b${expectedYear}\\b`).test(content), `Answer must identify festival year ${expectedYear}`)
  if (mode === 'unavailable') {
    assert(/no current official information(?: was)? found/i.test(content), 'Unavailable answer must explicitly refuse unsupported current information')
    assert(!/\b2025\b|Oct(?:ober)?\s+16/i.test(content), 'Unavailable 2026 answer must not fall back to the 2025 fixture')
    return
  }

  const expectedDay = expectedYear === 2025 ? 16 : 21
  const expectedHour = expectedYear === 2025 ? 9 : 10
  assert(new RegExp(`Oct(?:ober)?\\s+${expectedDay}(?:,)?\\s+${expectedYear}`, 'i').test(content), `Answer must include October ${expectedDay}, ${expectedYear}`)
  assert(new RegExp(`\\b${expectedHour}(?::00)?\\s*A\\.?M\\.?\\b`, 'i').test(content), `Answer must include ${expectedHour}:00 AM`)
  assert(/Negros Oriental Convention Center/i.test(content), 'Answer must include the fixture venue')
}
