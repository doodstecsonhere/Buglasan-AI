import { describe, expect, it } from 'vitest'
import { eventTimelineSuggestions, localIsoDay, resolveEventTimelinePhase, type EventTimelineConfig } from './eventTimeline'

// Synthetic non-Buglasan event: proves the selection logic is generic and
// text-free (the same machinery E-AI-E will reuse with its own config).
const harborConfig: EventTimelineConfig = {
  timeZone: 'America/New_York',
  startIsoDay: '2026-08-07',
  endIsoDay: '2026-08-09',
  finaleIsoDay: '2026-08-09',
  specialIsoDays: ['2026-08-08'],
  before: ['b1', 'b2', 'b3'],
  during: ['d1', 'd2', 'd3'],
  special: ['s1', 's2', 's3'],
  finale: ['f1', 'f2', 'f3'],
  after: ['a1', 'a2', 'a3'],
}

describe('eventTimeline localIsoDay', () => {
  it('resolves the calendar day in the event zone, not the host zone', () => {
    // 2026-10-15T00:30+08:00 is still Oct 14 in UTC/New York.
    const instant = new Date('2026-10-14T16:30:00.000Z')
    expect(localIsoDay(instant, 'Asia/Manila')).toBe('2026-10-15')
    expect(localIsoDay(instant, 'UTC')).toBe('2026-10-14')
    expect(localIsoDay(instant, 'America/New_York')).toBe('2026-10-14')
  })

  it('pins exact midnight boundaries', () => {
    expect(localIsoDay(new Date('2026-10-14T15:59:59.000Z'), 'Asia/Manila')).toBe('2026-10-14')
    expect(localIsoDay(new Date('2026-10-14T16:00:00.000Z'), 'Asia/Manila')).toBe('2026-10-15')
    expect(localIsoDay(new Date('2026-10-24T16:00:00.000Z'), 'Asia/Manila')).toBe('2026-10-25')
  })
})

describe('eventTimeline phase resolution', () => {
  it('maps days around a window to before/during/special/finale/after', () => {
    expect(resolveEventTimelinePhase(harborConfig, '2026-08-06')).toBe('before')
    expect(resolveEventTimelinePhase(harborConfig, '2026-08-07')).toBe('during')
    expect(resolveEventTimelinePhase(harborConfig, '2026-08-08')).toBe('special')
    expect(resolveEventTimelinePhase(harborConfig, '2026-08-09')).toBe('finale')
    expect(resolveEventTimelinePhase(harborConfig, '2026-08-10')).toBe('after')
  })

  it('lets explicit duringIsoDays win over special overrides', () => {
    const withPin: EventTimelineConfig = { ...harborConfig, duringIsoDays: ['2026-08-08'] }
    expect(resolveEventTimelinePhase(withPin, '2026-08-08')).toBe('during')
  })

  it('treats a missing finale/special config as plain during', () => {
    const bare: EventTimelineConfig = { timeZone: 'UTC', startIsoDay: '2026-01-01', endIsoDay: '2026-01-03', before: ['b1', 'b2', 'b3'], during: ['d1', 'd2', 'd3'], after: ['a1', 'a2', 'a3'] }
    expect(resolveEventTimelinePhase(bare, '2026-01-02')).toBe('during')
    expect(eventTimelineSuggestions(bare, new Date('2026-01-02T12:00:00Z'))).toEqual(['d1', 'd2', 'd3'])
  })
})

describe('eventTimeline suggestions', () => {
  it('returns exactly three strings for every phase', () => {
    for (const day of ['2026-08-01', '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-31']) {
      expect(eventTimelineSuggestions(harborConfig, new Date(`${day}T12:00:00Z`))).toHaveLength(3)
    }
  })

  it('picks the phase set for the event-local day near midnight', () => {
    // Early morning Aug 8 in New York while most of the world is still on Aug 7.
    expect(eventTimelineSuggestions(harborConfig, new Date('2026-08-08T04:30:00.000Z'))).toEqual(['s1', 's2', 's3'])
    expect(eventTimelineSuggestions(harborConfig, new Date('2026-08-07T03:30:00.000Z'))).toEqual(['b1', 'b2', 'b3'])
    expect(eventTimelineSuggestions(harborConfig, new Date('2026-08-09T04:00:00.000Z'))).toEqual(['f1', 'f2', 'f3'])
    // Aug 10 00:30 New York = Aug 10 04:30 UTC: window closed in the event zone.
    expect(eventTimelineSuggestions(harborConfig, new Date('2026-08-10T04:30:00.000Z'))).toEqual(['a1', 'a2', 'a3'])
  })

  it('fails closed when a phase does not carry exactly three suggestions', () => {
    const broken: EventTimelineConfig = { ...harborConfig, special: ['only-two-1', 'only-two-2'] }
    expect(() => eventTimelineSuggestions(broken, new Date('2026-08-08T12:00:00Z'))).toThrow('exactly 3')
  })
})
