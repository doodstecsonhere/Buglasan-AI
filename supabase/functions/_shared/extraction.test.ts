import { describe, expect, it } from 'vitest'
import { extractionIdentity, normalizeManilaTimestamp, parseModelJson, validateExtractionResult } from './extraction.ts'

const source = 'Buglasan Dance Showdown 2027 is confirmed on October 18, 2027 at 6:00 PM at Freedom Park. Admission is FREE.'
const candidate = {
  event_name: 'Buglasan Dance Showdown', aliases: [], description: null, category: 'competition',
  start_datetime: '2027-10-18T18:00:00+08:00', end_datetime: null, venue: 'Freedom Park', organizer: null,
  deadline: null, eligibility: null, fee_kind: 'free', fees: 'FREE', contact_info: null,
  status: 'confirmed', festival_year: 2027,
  evidence: [
    { field: 'event_name', excerpt: 'Buglasan Dance Showdown' }, { field: 'category', excerpt: 'Dance Showdown' },
    { field: 'start_datetime', excerpt: 'October 18, 2027 at 6:00 PM' }, { field: 'venue', excerpt: 'Freedom Park' },
    { field: 'fee_kind', excerpt: 'FREE' }, { field: 'fees', excerpt: 'FREE' },
    { field: 'status', excerpt: 'confirmed' }, { field: 'festival_year', excerpt: '2027' },
  ], review_reasons: [],
}

describe('knowledge extraction contract', () => {
  it('accepts a complete evidence-grounded candidate and normalizes Manila time', () => {
    const outcome = validateExtractionResult({ candidates: [candidate], source_summary: null }, source)
    expect(outcome.result.candidates[0].start_datetime).toBe('2027-10-18T10:00:00.000Z')
    expect(outcome.needsReview).toBe(false)
  })

  it('supports zero, one, or multiple candidates and preserves unsupported values as null', () => {
    expect(validateExtractionResult({ candidates: [], source_summary: null }, source).result.candidates).toEqual([])
    const partial = { ...candidate, event_name: null, category: null, evidence: candidate.evidence.filter((e) => !['event_name', 'category'].includes(e.field)) }
    expect(validateExtractionResult({ candidates: [partial, candidate], source_summary: null }, source).reasons).toContain('candidate_name_missing')
  })

  it.each([
    ['bad enum', { ...candidate, category: 'party' }, /enum/],
    ['bad year', { ...candidate, festival_year: 1800 }, /festival_year/],
    ['bad timestamp', { ...candidate, start_datetime: '2027-10-18 18:00' }, /timezone/],
    ['bad evidence', { ...candidate, venue: 'Fabricated Hall' }, /without evidence/],
    ['non-source excerpt', { ...candidate, evidence: [{ field: 'event_name', excerpt: 'Invented Event' }] }, /exact source substring/],
  ])('rejects %s', (_name, bad, error) => expect(() => validateExtractionResult({ candidates: [bad], source_summary: null }, source)).toThrow(error))

  it('rejects malformed JSON and requires explicit timestamp offsets', () => {
    expect(() => parseModelJson('{bad')).toThrow('malformed JSON')
    expect(() => normalizeManilaTimestamp('2027-10-18T18:00:00', 'date')).toThrow('timezone')
  })

  it('rejects an invented midnight timestamp when evidence contains only a calendar date', () => {
    const dateOnlySource = 'Buglasan Parade 2027 happens October 20, 2027.'
    const dateOnly = {
      ...candidate,
      event_name: 'Buglasan Parade 2027',
      category: 'parade',
      start_datetime: '2027-10-20T00:00:00+08:00',
      venue: null,
      fee_kind: 'unknown',
      fees: null,
      status: null,
      evidence: [
        { field: 'event_name', excerpt: 'Buglasan Parade 2027' },
        { field: 'category', excerpt: 'Parade' },
        { field: 'start_datetime', excerpt: 'October 20, 2027' },
        { field: 'festival_year', excerpt: '2027' },
      ],
    }
    expect(() => validateExtractionResult({ candidates: [dateOnly], source_summary: null }, dateOnlySource))
      .toThrow('explicit local time')
  })

  it('accepts a registration-extension deadline supported by explicit deadline-time evidence', () => {
    const extensionSource = 'Registration for Buglasan Lantern Parade 2027 at Freedom Park on October 18, 2027 at 6:00 PM is extended until October 10, 2027 at 11:59 PM.'
    const extension = {
      ...candidate,
      event_name: 'Buglasan Lantern Parade 2027',
      category: null,
      deadline: '2027-10-10T23:59:00+08:00',
      fee_kind: 'unknown',
      fees: null,
      status: null,
      evidence: [
        { field: 'event_name', excerpt: 'Buglasan Lantern Parade 2027' },
        { field: 'start_datetime', excerpt: 'October 18, 2027 at 6:00 PM' },
        { field: 'venue', excerpt: 'Freedom Park' },
        { field: 'deadline', excerpt: 'October 10, 2027 at 11:59 PM' },
        { field: 'festival_year', excerpt: '2027' },
      ],
    }
    const outcome = validateExtractionResult({ candidates: [extension], source_summary: null }, extensionSource)
    expect(outcome.result.candidates[0].deadline).toBe('2027-10-10T15:59:00.000Z')
  })

  it('uses fingerprint/version/index identity rather than fuzzy names', () => {
    expect(extractionIdentity('s', 'f', 'v1', 0)).toBe('s:f:v1:0')
    expect(extractionIdentity('s', 'changed', 'v1', 0)).not.toBe(extractionIdentity('s', 'f', 'v1', 0))
  })

  it('removes unsupported aliases and fee assertions and routes them to review', () => {
    const unsupported = { ...candidate, aliases: ['Invented Alias'], fee_kind: 'paid', fees: 'PHP 500' }
    const outcome = validateExtractionResult({ candidates: [unsupported], source_summary: null }, source)
    expect(outcome.result.candidates[0].aliases).toEqual([])
    expect(outcome.result.candidates[0].fee_kind).toBe('unknown')
    expect(outcome.result.candidates[0].fees).toBeNull()
    expect(outcome.reasons).toEqual(expect.arrayContaining(['unsupported_alias_removed', 'unsupported_fee_removed']))
    expect(outcome.needsReview).toBe(true)
  })
})
