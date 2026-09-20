import { describe, expect, it } from 'vitest'
import {
  answerClaimsEventOnResolvedDate,
  buildUnprovenTemporalFallback,
  evidenceBindsResolvedDate,
} from '../supabase/functions/chat/grounding.ts'

/**
 * Deterministic regression coverage for the temporal date-proof invariant
 * (mission A4). These exercise the pure guards the chat Edge Function applies
 * after generation for relative-date queries such as "What are the Buglasan
 * events for today?". The resolved production incident: a "today" query on
 * September 20, 2026 (festival window Oct 15-25) claimed the undated
 * "Hara sa Negros Oriental 2026" was "taking place today".
 */

const sep20 = () => new Date(2026, 8, 20)
const sep21 = () => new Date(2026, 8, 21)

// The exact wrong-answer sentence shape from the incident.
const FALSE_TODAY_CLAIM = "Conferment of Hara sa Negros Oriental 2026 — the royal pageant crowning the province's queens is taking place today."
// A cautious answer that correctly declines while still framing the festival window.
const CONSERVATIVE_ANSWER = 'No Buglasan events are currently listed for today, September 20, in the available official sources. The Buglasan Festival runs October 15–25, 2026.'

describe('temporal date-proof: evidence binds a resolved date only via an explicit calendar date', () => {
  it('undated festival source does NOT prove the target date', () => {
    const undated = 'Hara sa Negros Oriental 2026 — the royal pageant crowning the province’s queens. #BuglasanFestival'
    expect(evidenceBindsResolvedDate(undated, sep20(), sep20())).toBe(false)
  })

  it('an explicitly dated September 20 source DOES prove the target date', () => {
    const dated = 'September 20, 2026 — Hara sa Negros Oriental, a pre-festival pageant at the Provincial Capitol.'
    expect(evidenceBindsResolvedDate(dated, sep20(), sep20())).toBe(true)
  })

  it('a source dated on another day does not prove the target date', () => {
    expect(evidenceBindsResolvedDate('Opening parade on October 15, 2026', sep20(), sep20())).toBe(false)
  })

  it('accepts abbreviated, day-first and ISO spellings of the target date', () => {
    expect(evidenceBindsResolvedDate('Sep 20 pageant', sep20(), sep20())).toBe(true)
    expect(evidenceBindsResolvedDate('20 September gathering', sep20(), sep20())).toBe(true)
    expect(evidenceBindsResolvedDate('schedule: 2026-09-20', sep20(), sep20())).toBe(true)
  })
})

describe('temporal date-proof: affirmative claims are distinguished from cautious denials', () => {
  it('flags "is taking place today" as an affirmative event-on-date claim', () => {
    expect(answerClaimsEventOnResolvedDate(FALSE_TODAY_CLAIM)).toBe(true)
  })

  it('flags a "tomorrow" affirmative claim the same way', () => {
    expect(answerClaimsEventOnResolvedDate('The Parade of the Sun happens tomorrow along the baywalk.')).toBe(true)
  })

  it('does NOT flag a conservative "no events today" answer', () => {
    expect(answerClaimsEventOnResolvedDate(CONSERVATIVE_ANSWER)).toBe(false)
  })

  it('does NOT flag a bare festival-window mention that names no day-specific event', () => {
    expect(answerClaimsEventOnResolvedDate('The Buglasan Festival is scheduled for October 15-25, 2026.')).toBe(false)
  })
})

describe('temporal date-proof guard end-to-end decision (mirrors chat/index.ts)', () => {
  const guardFires = (evidenceText: string, structuredEventCount: number, answer: string, start: Date, end: Date) => {
    const hasDateProof = structuredEventCount > 0 || evidenceBindsResolvedDate(evidenceText, start, end)
    return !hasDateProof && answerClaimsEventOnResolvedDate(answer)
  }

  it('1) today=Sep 20, festival Oct 15-25, no explicit Sep 20 event → no event claimed for today', () => {
    expect(guardFires('Hara sa Negros Oriental 2026 royal pageant', 0, FALSE_TODAY_CLAIM, sep20(), sep20())).toBe(true)
  })

  it('2) a semantically relevant undated event cannot be promoted to today', () => {
    // The undated source is the most topically-similar match, yet it proves nothing.
    expect(guardFires('Buglasan Hara sa Negros Oriental pageant crowning queens festival', 0, FALSE_TODAY_CLAIM, sep20(), sep20())).toBe(true)
  })

  it('3) an explicitly dated Sep 20 event may be returned for today (guard must not over-block)', () => {
    const dated = 'September 20, 2026 — Hara sa Negros Oriental pre-festival pageant'
    expect(guardFires(dated, 0, FALSE_TODAY_CLAIM, sep20(), sep20())).toBe(false)
    // A structured event already on the target date is also sufficient proof.
    expect(guardFires('undated text', 1, FALSE_TODAY_CLAIM, sep20(), sep20())).toBe(false)
  })

  it('4) tomorrow resolution behaves the same as today', () => {
    expect(guardFires('Hara sa Negros Oriental 2026 royal pageant', 0, 'The Parade of the Sun happens tomorrow.', sep21(), sep21())).toBe(true)
    expect(guardFires('September 21, 2026 — Parade of the Sun', 0, 'The Parade of the Sun happens tomorrow.', sep21(), sep21())).toBe(false)
  })

  it('5) festival-window context is preserved when the answer already declines', () => {
    // Conservative wording is not rewritten because the guard does not fire.
    expect(guardFires('Hara sa Negros Oriental 2026', 0, CONSERVATIVE_ANSWER, sep20(), sep20())).toBe(false)
  })
})

describe('temporal date-proof: conservative fallback wording is evidence-bounded, not exhaustive', () => {
  const en = buildUnprovenTemporalFallback('Sunday, September 20', 'en')

  it('uses cautious "currently listed" / "available official sources" framing', () => {
    expect(en).toMatch(/currently listed/i)
    expect(en).toMatch(/available official sources/i)
    expect(en).toContain('Sunday, September 20')
  })

  it('never makes an unjustified exhaustive "no events exist" claim', () => {
    expect(en).not.toMatch(/no official events exist/i)
    expect(en).not.toMatch(/there are no events\b/i)
  })
})
