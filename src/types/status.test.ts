/**
 * Buglasan AI - Status Model Tests (Phase 6)
 *
 * Focused tests for the canonical status model helpers in src/types/index.ts:
 *   - isSourceCurrent()  : active / updated / postponed → true
 *   - isSourceCurrent()  : superseded / cancelled / archived → false
 *   - isEventCurrent()   : scheduled / confirmed → true
 *   - isEventCurrent()   : cancelled / postponed / completed → false
 *
 * These helpers mirror the DB-level GENERATED ALWAYS AS columns:
 *   sources.is_current = status IN ('active', 'updated', 'postponed')
 *   events.is_current  = status IN ('scheduled', 'confirmed')
 *
 * If you change the canonical status model, change these tests too.
 */

import { describe, it, expect } from 'vitest'
import type { Source, Event, SourceStatus, EventStatus } from './index'
import { isSourceCurrent, isEventCurrent } from './index'

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeSource(status: SourceStatus, idSuffix = ''): Source {
  return {
    id: `src-${status}${idSuffix}`,
    platform: 'facebook',
    postId: `post-${status}`,
    postUrl: `https://example.test/${status}`,
    publishedAt: new Date('2026-09-01T10:00:00+08:00'),
    festivalYear: 2026,
    rawText: `[fixture] ${status}`,
    normalizedText: `[fixture] ${status}`,
    status,
    ingestedAt: new Date('2026-09-01T10:00:00+08:00'),
    updatedAt: new Date('2026-09-01T10:00:00+08:00'),
  }
}

function makeEvent(status: EventStatus, idSuffix = ''): Event {
  return {
    id: `evt-${status}${idSuffix}`,
    eventName: `Event ${status}`,
    aliases: [],
    description: '',
    category: 'ceremony',
    startDatetime: new Date('2026-10-15T18:00:00+08:00'),
    endDatetime: new Date('2026-10-15T21:00:00+08:00'),
    venue: 'Freedom Park',
    organizer: 'Provincial Government',
    status,
    festivalYear: 2026,
    createdAt: new Date('2026-09-01T10:00:00+08:00'),
    updatedAt: new Date('2026-09-01T10:00:00+08:00'),
  }
}

// ---------------------------------------------------------------------------
// isSourceCurrent
// ---------------------------------------------------------------------------

describe('isSourceCurrent', () => {
  it('returns true for active sources', () => {
    expect(isSourceCurrent(makeSource('active'))).toBe(true)
  })

  it('returns true for updated sources', () => {
    expect(isSourceCurrent(makeSource('updated'))).toBe(true)
  })

  it('returns true for postponed sources', () => {
    expect(isSourceCurrent(makeSource('postponed'))).toBe(true)
  })

  it('returns false for superseded sources', () => {
    expect(isSourceCurrent(makeSource('superseded'))).toBe(false)
  })

  it('returns false for cancelled sources', () => {
    expect(isSourceCurrent(makeSource('cancelled'))).toBe(false)
  })

  it('returns false for archived sources', () => {
    expect(isSourceCurrent(makeSource('archived'))).toBe(false)
  })

  it('matches DB-derived truth table (active | updated | postponed → true)', () => {
    const truthy: SourceStatus[] = ['active', 'updated', 'postponed']
    for (const status of truthy) {
      expect(isSourceCurrent(makeSource(status))).toBe(true)
    }
  })

  it('matches DB-derived truth table (superseded | cancelled | archived → false)', () => {
    const falsy: SourceStatus[] = ['superseded', 'cancelled', 'archived']
    for (const status of falsy) {
      expect(isSourceCurrent(makeSource(status))).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// isEventCurrent
// ---------------------------------------------------------------------------

describe('isEventCurrent', () => {
  it('returns true for scheduled events', () => {
    expect(isEventCurrent(makeEvent('scheduled'))).toBe(true)
  })

  it('returns true for confirmed events', () => {
    expect(isEventCurrent(makeEvent('confirmed'))).toBe(true)
  })

  it('returns false for cancelled events', () => {
    expect(isEventCurrent(makeEvent('cancelled'))).toBe(false)
  })

  it('returns false for postponed events', () => {
    expect(isEventCurrent(makeEvent('postponed'))).toBe(false)
  })

  it('returns false for completed events', () => {
    expect(isEventCurrent(makeEvent('completed'))).toBe(false)
  })

  it('matches DB-derived truth table (scheduled | confirmed → true)', () => {
    const truthy: EventStatus[] = ['scheduled', 'confirmed']
    for (const status of truthy) {
      expect(isEventCurrent(makeEvent(status))).toBe(true)
    }
  })

  it('matches DB-derived truth table (cancelled | postponed | completed → false)', () => {
    const falsy: EventStatus[] = ['cancelled', 'postponed', 'completed']
    for (const status of falsy) {
      expect(isEventCurrent(makeEvent(status))).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Cross-helper consistency
// ---------------------------------------------------------------------------

describe('status helpers: cross-consistency', () => {
  it('source status truth table has 3 trues and 3 falses', () => {
    const allStatuses: SourceStatus[] = ['active', 'updated', 'superseded', 'cancelled', 'postponed', 'archived']
    const trueCount = allStatuses.filter((s) => isSourceCurrent(makeSource(s))).length
    const falseCount = allStatuses.filter((s) => !isSourceCurrent(makeSource(s))).length
    expect(trueCount).toBe(3)
    expect(falseCount).toBe(3)
  })

  it('event status truth table has 2 trues and 3 falses', () => {
    const allStatuses: EventStatus[] = ['scheduled', 'confirmed', 'cancelled', 'postponed', 'completed']
    const trueCount = allStatuses.filter((s) => isEventCurrent(makeEvent(s))).length
    const falseCount = allStatuses.filter((s) => !isEventCurrent(makeEvent(s))).length
    expect(trueCount).toBe(2)
    expect(falseCount).toBe(3)
  })
})
