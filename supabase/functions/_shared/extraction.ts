export const EXTRACTION_STATUSES = [
  'pending', 'processing', 'extracted', 'no_event', 'needs_review',
  'retryable_error', 'permanent_error',
] as const

export const EVENT_CATEGORIES = [
  'ceremony', 'competition', 'exhibit', 'food', 'trade', 'cultural',
  'sports', 'workshop', 'concert', 'parade', 'other',
] as const

export const EVENT_STATUSES = ['scheduled', 'confirmed', 'cancelled', 'postponed', 'completed'] as const
export const FEE_KINDS = ['free', 'paid', 'unknown'] as const

export type ExtractionStatus = typeof EXTRACTION_STATUSES[number]
export type EventCategory = typeof EVENT_CATEGORIES[number]
export type EventStatus = typeof EVENT_STATUSES[number]
export type FeeKind = typeof FEE_KINDS[number]

export interface EvidenceExcerpt {
  field: string
  excerpt: string
}

export interface EventCandidate {
  event_name: string | null
  aliases: string[]
  description: string | null
  category: EventCategory | null
  start_datetime: string | null
  end_datetime: string | null
  venue: string | null
  organizer: string | null
  deadline: string | null
  eligibility: string | null
  fee_kind: FeeKind
  fees: string | null
  contact_info: string | null
  status: EventStatus | null
  festival_year: number | null
  evidence: EvidenceExcerpt[]
  review_reasons: string[]
}

export interface ExtractionResult {
  candidates: EventCandidate[]
  source_summary: string | null
}

export interface ValidationOutcome {
  result: ExtractionResult
  needsReview: boolean
  reasons: string[]
}

const CANDIDATE_KEYS = [
  'event_name', 'aliases', 'description', 'category', 'start_datetime', 'end_datetime',
  'venue', 'organizer', 'deadline', 'eligibility', 'fee_kind', 'fees', 'contact_info',
  'status', 'festival_year', 'evidence', 'review_reasons',
] as const

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/
const urlPattern = /^https?:\/\/[^\s]+$/i
const explicitTimePattern = /(?:\b(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*[ap]m)?\b|\b(?:1[0-2]|0?[1-9])\s*[ap]m\b|\b(?:noon|midnight)\b)/i

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${label} must be a string or null`)
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label} must be a string array`)
  return value.map((item) => item.trim()).filter(Boolean)
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string, nullable = true): T | null {
  if (value === null && nullable) return null
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`${label} has an invalid enum value`)
  return value as T
}

/** Converts an offset-bearing timestamp to the equivalent ISO instant. Asia/Manila is the interpretation boundary, never the publication date. */
export function normalizeManilaTimestamp(value: unknown, label: string): string | null {
  const text = nullableString(value, label)
  if (text === null) return null
  if (!timestampPattern.test(text)) throw new Error(`${label} must be an ISO timestamp with timezone`)
  const date = new Date(text)
  if (Number.isNaN(date.valueOf())) throw new Error(`${label} is not a real timestamp`)
  return date.toISOString()
}

function validateYear(value: unknown): number | null {
  if (value === null) return null
  if (!Number.isInteger(value) || (value as number) < 1900 || (value as number) > 2100) {
    throw new Error('festival_year must be a nullable integer from 1900 through 2100')
  }
  return value as number
}

function requireUrlIfPresent(value: string | null, label: string): void {
  if (value && /(?:https?:\/\/|www\.)/i.test(value) && !urlPattern.test(value)) throw new Error(`${label} contains a malformed URL`)
}

function parseCandidate(value: unknown, sourceText: string, index: number): EventCandidate {
  const row = object(value, `candidates[${index}]`)
  const unknown = Object.keys(row).filter((key) => !(CANDIDATE_KEYS as readonly string[]).includes(key))
  const missing = CANDIDATE_KEYS.filter((key) => !(key in row))
  if (unknown.length || missing.length) throw new Error(`candidates[${index}] has unknown or missing fields`)

  const evidenceRaw = row.evidence
  if (!Array.isArray(evidenceRaw)) throw new Error(`candidates[${index}].evidence must be an array`)
  const evidence = evidenceRaw.map((item, evidenceIndex) => {
    const entry = object(item, `evidence[${evidenceIndex}]`)
    if (Object.keys(entry).some((key) => !['field', 'excerpt'].includes(key)) || !('field' in entry) || !('excerpt' in entry)) {
      throw new Error(`evidence[${evidenceIndex}] has unknown or missing fields`)
    }
    const field = nullableString(entry.field, 'evidence.field')
    const excerpt = nullableString(entry.excerpt, 'evidence.excerpt')
    if (!field || !excerpt) throw new Error('evidence field and excerpt must be non-empty')
    if (!(CANDIDATE_KEYS as readonly string[]).includes(field) || field === 'evidence' || field === 'review_reasons') {
      throw new Error(`evidence field ${field} is unsupported`)
    }
    if (!sourceText.includes(excerpt)) throw new Error(`evidence excerpt is not an exact source substring: ${excerpt}`)
    return { field, excerpt }
  })

  const eventName = nullableString(row.event_name, 'event_name')
  const start = normalizeManilaTimestamp(row.start_datetime, 'start_datetime')
  const end = normalizeManilaTimestamp(row.end_datetime, 'end_datetime')
  const deadline = normalizeManilaTimestamp(row.deadline, 'deadline')
  for (const [field, timestamp] of [['start_datetime', start], ['end_datetime', end], ['deadline', deadline]] as const) {
    if (timestamp !== null && !evidence.some((item) => item.field === field && explicitTimePattern.test(item.excerpt))) {
      throw new Error(`${field} requires evidence with an explicit local time`)
    }
  }
  if (start && end && new Date(end) < new Date(start)) throw new Error('end_datetime precedes start_datetime')
  const festivalYear = validateYear(row.festival_year)
  if (festivalYear !== null && start !== null) {
    const manilaYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Manila', year: 'numeric' }).format(new Date(start)))
    if (manilaYear !== festivalYear) throw new Error('festival_year conflicts with start_datetime in Asia/Manila')
  }
  const contact = nullableString(row.contact_info, 'contact_info')
  requireUrlIfPresent(contact, 'contact_info')

  const reviewReasons = stringArray(row.review_reasons, 'review_reasons')
  const aliases = stringArray(row.aliases, 'aliases')
  const aliasEvidence = evidence.filter((item) => item.field === 'aliases').map((item) => item.excerpt.toLocaleLowerCase())
  const supportedAliases = aliases.filter((alias) => aliasEvidence.some((excerpt) => excerpt.includes(alias.toLocaleLowerCase())))
  if (supportedAliases.length !== aliases.length) reviewReasons.push('unsupported_alias_removed')

  let feeKind = enumValue(row.fee_kind, FEE_KINDS, 'fee_kind', false) as FeeKind
  let fees = nullableString(row.fees, 'fees')
  const feeEvidence = evidence.filter((item) => item.field === 'fee_kind' || item.field === 'fees').map((item) => item.excerpt)
  const feeText = feeEvidence.join(' ')
  const freeSupported = /\bfree\b|\bno\s+(?:admission\s+)?fee\b/i.test(feeText)
  const paidSupported = /(?:₱\s*\d|PHP\s*\d|\d+(?:\.\d{1,2})?\s*peso(?:s)?\b|\bpaid\b|\b(?:admission|registration|entrance)\s+fee\s+(?:is|of)\s+\d)/i.test(feeText)
  const feesSupported = fees === null || evidence.some((item) => item.field === 'fees' && item.excerpt.toLocaleLowerCase().includes(fees!.toLocaleLowerCase()))
  if ((feeKind === 'free' && !freeSupported) || (feeKind === 'paid' && !paidSupported) || !feesSupported) {
    feeKind = 'unknown'
    fees = null
    reviewReasons.push('unsupported_fee_removed')
  }

  const candidate: EventCandidate = {
    event_name: eventName,
    aliases: supportedAliases,
    description: nullableString(row.description, 'description'),
    category: enumValue(row.category, EVENT_CATEGORIES, 'category'),
    start_datetime: start,
    end_datetime: end,
    venue: nullableString(row.venue, 'venue'),
    organizer: nullableString(row.organizer, 'organizer'),
    deadline,
    eligibility: nullableString(row.eligibility, 'eligibility'),
    fee_kind: feeKind,
    fees,
    contact_info: contact,
    status: enumValue(row.status, EVENT_STATUSES, 'status'),
    festival_year: festivalYear,
    evidence,
    review_reasons: [...new Set(reviewReasons)].sort(),
  }
  if (candidate.fee_kind === 'free' && candidate.fees !== null && !/^free$/i.test(candidate.fees)) throw new Error('free fee_kind conflicts with fees')
  if (candidate.fee_kind === 'unknown' && candidate.fees !== null) throw new Error('unknown fee_kind requires null fees')
  return candidate
}

/** Strictly parses model JSON; unsupported facts remain null and every asserted field must carry exact evidence. */
export function validateExtractionResult(payload: unknown, sourceText: string): ValidationOutcome {
  const root = object(payload, 'result')
  if (Object.keys(root).some((key) => !['candidates', 'source_summary'].includes(key)) || !Array.isArray(root.candidates) || !('source_summary' in root)) {
    throw new Error('result has unknown or missing fields')
  }
  const candidates = root.candidates.map((candidate, index) => parseCandidate(candidate, sourceText, index))
  const reasons = new Set<string>()
  for (const candidate of candidates) {
    for (const field of CANDIDATE_KEYS) {
      if (['aliases', 'evidence', 'review_reasons'].includes(field)) continue
      const asserted = candidate[field as keyof EventCandidate]
      if (asserted !== null && field !== 'fee_kind' && !candidate.evidence.some((item) => item.field === field)) {
        throw new Error(`${field} is asserted without evidence`)
      }
    }
    if (candidate.event_name === null) reasons.add('candidate_name_missing')
    candidate.review_reasons.forEach((reason) => reasons.add(reason))
    if (candidate.status === 'cancelled' || candidate.status === 'postponed') reasons.add('schedule_change')
  }
  return {
    result: { candidates, source_summary: nullableString(root.source_summary, 'source_summary') },
    needsReview: reasons.size > 0,
    reasons: [...reasons].sort(),
  }
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    throw new Error('model returned malformed JSON')
  }
}

export function extractionIdentity(sourceId: string, fingerprint: string, extractorVersion: string, candidateIndex: number): string {
  return `${sourceId}:${fingerprint}:${extractorVersion}:${candidateIndex}`
}
