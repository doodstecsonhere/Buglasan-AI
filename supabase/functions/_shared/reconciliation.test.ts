import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { compareCandidate, gateComparisons, hasCreationEvidence, isRetryableGeminiStatus, normalizeReconciliationText, parseGeminiClassification, rankShortlist, type Candidate, type CanonicalTarget } from './reconciliation.ts'

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: 'candidate', event_name: 'Buglasan Opening!', festival_year: 2026, start_datetime: '2026-10-15T18:00:00+08:00', venue: 'Freedom Park', organizer: 'Province', category: 'ceremony', extracted_source_id: 'source', source_fingerprint: 'fingerprint', extraction_identity: 'identity', extractor_version: 'phase6-v1', candidate_index: 0, extraction_evidence: [{ field: 'event_name', excerpt: 'Buglasan Opening' }, { field: 'start_datetime', locator: 'line:1' }], ...overrides,
})
const target = (id: string, overrides: Partial<CanonicalTarget['current_version']> = {}): CanonicalTarget => ({
  id, festival_year: 2026, lifecycle_status: 'scheduled', current_version: { event_name: 'Buglasan Opening', festival_year: 2026, start_datetime: '2026-10-15T18:00:00+08:00', venue: 'Freedom Park', organizer: 'Province', category: 'ceremony', ...overrides },
})

Deno.test('reconciliation: normalizes Unicode, punctuation, ampersands, and whitespace deterministically', () => {
  assertEquals(normalizeReconciliationText('  BUGLASAN—Food & Trade  '), 'buglasan food and trade')
})

Deno.test('reconciliation: ranks same-year identity features deterministically by UUID tie breaker', () => {
  const c = candidate()
  const ranked = rankShortlist([compareCandidate(c, target('b')), compareCandidate(c, target('a'))])
  assertEquals(ranked.map((item) => item.target_id), ['a', 'b'])
})

Deno.test('reconciliation: hard gate accepts exactly one strong identity and rejects ambiguity', () => {
  const c = candidate()
  assertEquals(gateComparisons([compareCandidate(c, target('one'))]), { passes: true, target_id: 'one', reason: 'single_strong_identity' })
  assertEquals(gateComparisons([compareCandidate(c, target('one')), compareCandidate(c, target('two'))]).reason, 'multiple_passing_targets')
})

Deno.test('reconciliation: disjoint dates fail unless direct source lineage proves a correction relationship', () => {
  const c = candidate({ start_datetime: '2026-10-01T18:00:00+08:00' })
  const comparison = compareCandidate(c, target('one'))
  assertEquals(comparison.date_relation, 'disjoint')
  assertEquals(gateComparisons([comparison]).passes, false)
  assertEquals(gateComparisons([{ ...comparison, source_lineage: 'direct' }]).passes, true)
})

Deno.test('reconciliation: creation requires name plus temporal or venue/organizer evidence', () => {
  assert(hasCreationEvidence(candidate()))
  assertEquals(hasCreationEvidence(candidate({ extraction_evidence: [{ field: 'event_name', excerpt: 'Opening' }] })), false)
  assertEquals(hasCreationEvidence(candidate({ extraction_evidence: [{ field: 'venue', locator: 'line:3' }] })), false)
})

Deno.test('reconciliation: malformed or out-of-shortlist Gemini answers fail closed and provider statuses classify safely', () => {
  assertEquals(parseGeminiClassification({ decision: 'choose_target_id', target_id: 'other', rationale: 'x' }, ['one']), null)
  assertEquals(parseGeminiClassification({ decision: 'create', target_id: null, rationale: 'x'.repeat(241) }, ['one']), null)
  assertEquals(parseGeminiClassification({ decision: 'needs_review', target_id: null, rationale: 'bounded' }, ['one'])?.decision, 'needs_review')
  assert(isRetryableGeminiStatus(429))
  assertEquals(isRetryableGeminiStatus(400), false)
})
