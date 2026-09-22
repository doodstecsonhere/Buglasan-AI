export const FRESHNESS_STATES = ['FRESH', 'AGING', 'STALE', 'UNKNOWN'] as const
export type FreshnessState = typeof FRESHNESS_STATES[number]

export const CORPUS_HEALTH_STATES = ['HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN'] as const
export type CorpusHealthState = typeof CORPUS_HEALTH_STATES[number]

export interface FreshnessThresholds {
  readonly agingAfterHours: number
  readonly staleAfterHours: number
}

export interface FreshnessPolicy {
  readonly thresholds: FreshnessThresholds
  readonly timeZone: string
  readonly dateTimeLocale: string
}

export interface FreshnessTimestampSet {
  readonly sourcePublishedAt?: string | null
  readonly sourceCollectedAt?: string | null
  readonly knowledgeBaseUpdatedAt?: string | null
}

export type FreshnessTimestampKind = keyof FreshnessTimestampSet

export interface EvaluatedFreshness {
  readonly kind: FreshnessTimestampKind
  readonly state: FreshnessState
  readonly timestamp: string | null
  readonly ageHours: number | null
  readonly formattedAt: string | null
}

export interface FreshnessEvaluation {
  readonly overallState: FreshnessState
  readonly timestamps: Readonly<Record<FreshnessTimestampKind, EvaluatedFreshness>>
}

export interface CorpusHealth {
  readonly state: CorpusHealthState
  readonly humilityFlag: boolean
  readonly copy: string
}

export type AnswerWarning = 'NONE' | 'STALE_SOURCE' | 'STALE_CORPUS' | 'MIXED_FRESHNESS' | 'UNKNOWN_FRESHNESS'

export interface AnswerFreshnessInput {
  readonly questionIsTimeSensitive: boolean
  readonly freshness: FreshnessEvaluation
  readonly corpusHealth: CorpusHealth
}

/** Additive, bounded metadata exposed with an answer; it never changes evidence selection. */
export interface FreshnessMetadata {
  readonly evaluation: FreshnessEvaluation
  readonly corpusHealth: CorpusHealth
  readonly warning: AnswerWarning
}

export function isTimeSensitiveQuestion(question: string): boolean {
  return /\b(today|tomorrow|tonight|now|currently|latest|recent|upcoming|schedule|when|date|deadline|open|available|cancel(?:led|lation)?|postponed|updated?)\b/i.test(question)
}

export function createFreshnessMetadata(
  question: string,
  timestamps: FreshnessTimestampSet,
  policy: FreshnessPolicy,
  now: Date,
  corpusHealth: CorpusHealth,
): FreshnessMetadata {
  const evaluation = evaluateFreshness(timestamps, policy, now)
  return Object.freeze({
    evaluation,
    corpusHealth,
    warning: classifyAnswerFreshnessWarning({ questionIsTimeSensitive: isTimeSensitiveQuestion(question), freshness: evaluation, corpusHealth }),
  })
}

function invalid(path: string, requirement: string): never {
  throw new Error(`Invalid freshness policy at ${path}: ${requirement}`)
}

function positiveFinite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) invalid(path, 'must be a positive finite number')
  return value
}

export function validateFreshnessPolicy(input: unknown): FreshnessPolicy {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('policy', 'must be an object')
  const value = input as Record<string, unknown>
  if (!value.thresholds || typeof value.thresholds !== 'object' || Array.isArray(value.thresholds)) invalid('thresholds', 'must be an object')
  const thresholds = value.thresholds as Record<string, unknown>
  const agingAfterHours = positiveFinite(thresholds.agingAfterHours, 'thresholds.agingAfterHours')
  const staleAfterHours = positiveFinite(thresholds.staleAfterHours, 'thresholds.staleAfterHours')
  if (agingAfterHours >= staleAfterHours) invalid('thresholds', 'agingAfterHours must be less than staleAfterHours')
  if (typeof value.timeZone !== 'string' || !value.timeZone.trim()) invalid('timeZone', 'must be a non-empty IANA time zone')
  if (typeof value.dateTimeLocale !== 'string' || !value.dateTimeLocale.trim()) invalid('dateTimeLocale', 'must be a non-empty locale')
  try { new Intl.DateTimeFormat(value.dateTimeLocale, { timeZone: value.timeZone }).format(0) } catch { invalid('timeZone', 'must be supported by Intl') }
  return deepFreeze({ thresholds: { agingAfterHours, staleAfterHours }, timeZone: value.timeZone, dateTimeLocale: value.dateTimeLocale })
}

function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value || typeof value !== 'string') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatFreshnessDate(timestamp: string, policy: FreshnessPolicy): string | null {
  const parsed = parseTimestamp(timestamp)
  if (!parsed) return null
  return new Intl.DateTimeFormat(policy.dateTimeLocale, {
    timeZone: policy.timeZone, dateStyle: 'medium', timeStyle: 'short', hour12: false,
  }).format(parsed)
}

export function evaluateTimestampFreshness(
  kind: FreshnessTimestampKind,
  timestamp: string | null | undefined,
  policy: FreshnessPolicy,
  now: Date,
): EvaluatedFreshness {
  const parsed = parseTimestamp(timestamp)
  const base = { kind, timestamp: timestamp ?? null, ageHours: null, formattedAt: timestamp ? formatFreshnessDate(timestamp, policy) : null }
  if (!parsed || Number.isNaN(now.getTime())) return { ...base, state: 'UNKNOWN' }
  const ageHours = (now.getTime() - parsed.getTime()) / 3_600_000
  if (ageHours < 0) return { ...base, state: 'UNKNOWN', ageHours }
  const state: FreshnessState = ageHours < policy.thresholds.agingAfterHours ? 'FRESH' : ageHours < policy.thresholds.staleAfterHours ? 'AGING' : 'STALE'
  return { ...base, state, ageHours }
}

export function evaluateFreshness(input: FreshnessTimestampSet, policy: FreshnessPolicy, now: Date): FreshnessEvaluation {
  const kinds: readonly FreshnessTimestampKind[] = ['sourcePublishedAt', 'sourceCollectedAt', 'knowledgeBaseUpdatedAt']
  const timestamps = Object.fromEntries(kinds.map(kind => [kind, evaluateTimestampFreshness(kind, input[kind], policy, now)])) as Record<FreshnessTimestampKind, EvaluatedFreshness>
  const states = kinds.map(kind => timestamps[kind].state)
  const overallState: FreshnessState = states.every(state => state === 'UNKNOWN') ? 'UNKNOWN' : states.includes('STALE') ? 'STALE' : states.includes('AGING') ? 'AGING' : 'FRESH'
  return { overallState, timestamps }
}

export function createCorpusHealth(state: CorpusHealthState, copy: string): CorpusHealth {
  if (!CORPUS_HEALTH_STATES.includes(state)) throw new Error(`Unsupported corpus health state: ${state}`)
  if (!copy.trim()) throw new Error('Corpus health copy must not be empty')
  return Object.freeze({ state, humilityFlag: state !== 'HEALTHY', copy })
}

export function classifyAnswerFreshnessWarning(input: AnswerFreshnessInput): AnswerWarning {
  if (!input.questionIsTimeSensitive) return 'NONE'
  if (input.corpusHealth.state === 'UNAVAILABLE' || input.corpusHealth.state === 'UNKNOWN') return 'STALE_CORPUS'
  const { sourcePublishedAt, sourceCollectedAt, knowledgeBaseUpdatedAt } = input.freshness.timestamps
  const sourceStates = [sourcePublishedAt.state, sourceCollectedAt.state]
  const corpusState = knowledgeBaseUpdatedAt.state
  if (sourceStates.includes('UNKNOWN') || corpusState === 'UNKNOWN') return 'UNKNOWN_FRESHNESS'
  if (sourceStates.includes('STALE') && corpusState === 'STALE') return 'STALE_SOURCE'
  if (sourceStates.includes('STALE')) return 'STALE_SOURCE'
  if (corpusState === 'STALE') return 'STALE_CORPUS'
  if (sourceStates.includes('AGING') || corpusState === 'AGING') return 'MIXED_FRESHNESS'
  return 'NONE'
}

function deepFreeze<T extends object>(value: T): Readonly<T> {
  Reflect.ownKeys(value).forEach(key => {
    const nested = Reflect.get(value, key)
    if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) deepFreeze(nested)
  })
  return Object.freeze(value)
}
