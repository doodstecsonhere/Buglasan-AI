export const RECONCILER_VERSION = 'reconciler-v1'

export type Candidate = {
  id: string; event_name: string; aliases?: string[]; festival_year: number; start_datetime?: string | null; end_datetime?: string | null
  venue?: string | null; organizer?: string | null; category?: string | null; description?: string | null; deadline?: string | null; eligibility?: string | null; fees?: string | null; contact_info?: string | null; status?: string | null; extracted_source_id: string; source_fingerprint: string
  extraction_identity: string; extractor_version: string; candidate_index: number; extraction_evidence: unknown[]; created_at?: string
}
export type CanonicalTarget = { id: string; festival_year: number; lifecycle_status: string; current_version: Omit<Candidate, 'id' | 'extracted_source_id' | 'source_fingerprint' | 'extraction_identity' | 'extractor_version' | 'candidate_index' | 'extraction_evidence'> & { aliases?: string[] } }
export type Comparison = { target_id: string; name_exact: boolean; name_token_overlap_bp: number; date_relation: 'same_day'|'overlap'|'within_48_hours'|'disjoint'|'unknown'; venue_exact: boolean; organizer_exact: boolean; category_equal: boolean; source_lineage: 'same'|'direct'|'unrelated' }

export function normalizeReconciliationText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().replace(/\s+/g, ' ')
}
export const tokens = (value: string | null | undefined) => new Set(normalizeReconciliationText(value).split(' ').filter(Boolean))
function dateRelation(candidate: Candidate, target: CanonicalTarget): Comparison['date_relation'] {
  const aStart = candidate.start_datetime ? Date.parse(candidate.start_datetime) : NaN; const aEnd = candidate.end_datetime ? Date.parse(candidate.end_datetime) : aStart
  const bStart = target.current_version.start_datetime ? Date.parse(target.current_version.start_datetime) : NaN; const bEnd = target.current_version.end_datetime ? Date.parse(target.current_version.end_datetime) : bStart
  if (![aStart, aEnd, bStart, bEnd].every(Number.isFinite)) return 'unknown'
  if (new Date(aStart).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) === new Date(bStart).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })) return 'same_day'
  if (aStart <= bEnd && bStart <= aEnd) return 'overlap'
  return Math.min(Math.abs(aStart - bEnd), Math.abs(bStart - aEnd)) <= 48 * 60 * 60 * 1000 ? 'within_48_hours' : 'disjoint'
}
export function compareCandidate(candidate: Candidate, target: CanonicalTarget, sourceLineage: Comparison['source_lineage'] = 'unrelated'): Comparison {
  const name = normalizeReconciliationText(candidate.event_name); const targetNames = [target.current_version.event_name, ...(target.current_version.aliases ?? [])].map(normalizeReconciliationText)
  const left = tokens(candidate.event_name); const right = tokens(target.current_version.event_name); const union = new Set([...left, ...right]); const intersection = [...left].filter((token) => right.has(token)).length
  const equal = (a: string | null | undefined, b: string | null | undefined) => !!normalizeReconciliationText(a) && normalizeReconciliationText(a) === normalizeReconciliationText(b)
  return { target_id: target.id, name_exact: targetNames.includes(name), name_token_overlap_bp: union.size ? Math.floor(10_000 * intersection / union.size) : 0, date_relation: dateRelation(candidate, target), venue_exact: equal(candidate.venue, target.current_version.venue), organizer_exact: equal(candidate.organizer, target.current_version.organizer), category_equal: !!candidate.category && candidate.category === target.current_version.category, source_lineage: sourceLineage }
}
const relationRank = { same_day: 4, overlap: 3, within_48_hours: 2, unknown: 1, disjoint: 0 } as const
const lineageRank = { same: 2, direct: 1, unrelated: 0 } as const
export function rankShortlist(comparisons: Comparison[]): Comparison[] {
  return [...comparisons].sort((a, b) => Number(b.name_exact) - Number(a.name_exact) || b.name_token_overlap_bp - a.name_token_overlap_bp || relationRank[b.date_relation] - relationRank[a.date_relation] || Number(b.venue_exact) - Number(a.venue_exact) || Number(b.organizer_exact) - Number(a.organizer_exact) || Number(b.category_equal) - Number(a.category_equal) || lineageRank[b.source_lineage] - lineageRank[a.source_lineage] || a.target_id.localeCompare(b.target_id))
}
export function gateComparisons(comparisons: Comparison[]): { passes: boolean; target_id?: string; reason: string } {
  const passing = comparisons.filter((x) => (x.name_exact && (['same_day', 'overlap'].includes(x.date_relation) || x.venue_exact || x.organizer_exact || x.source_lineage === 'direct')) || (x.name_token_overlap_bp >= 8500 && ['same_day', 'overlap'].includes(x.date_relation) && (x.venue_exact || x.organizer_exact || x.category_equal || x.source_lineage === 'direct'))).filter((x) => !(x.date_relation === 'disjoint' && x.source_lineage !== 'direct'))
  return passing.length === 1 ? { passes: true, target_id: passing[0].target_id, reason: 'single_strong_identity' } : { passes: false, reason: passing.length ? 'multiple_passing_targets' : 'no_passing_target' }
}
export function hasCreationEvidence(candidate: Candidate): boolean {
  const fields = new Set(candidate.extraction_evidence.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object').map((item) => item.field))
  return fields.has('event_name') && (fields.has('start_datetime') || fields.has('end_datetime') || fields.has('venue') || fields.has('organizer'))
}

export type GeminiClassification = { decision: 'needs_review' | 'choose_target_id' | 'create'; target_id: string | null; rationale: string }
export function parseGeminiClassification(value: unknown, allowedTargetIds: readonly string[]): GeminiClassification | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if ((input.decision !== 'needs_review' && input.decision !== 'choose_target_id' && input.decision !== 'create') || typeof input.rationale !== 'string' || input.rationale.length > 240) return null
  if (input.decision === 'choose_target_id') return typeof input.target_id === 'string' && allowedTargetIds.includes(input.target_id) ? { decision: input.decision, target_id: input.target_id, rationale: input.rationale } : null
  return input.target_id === null ? { decision: input.decision, target_id: null, rationale: input.rationale } : null
}
export function isRetryableGeminiStatus(status: number): boolean { return [429, 500, 502, 503, 504].includes(status) }
