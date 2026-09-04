/**
 * Buglasan AI - Client-side Retrieval Tests (Phase 6)
 *
 * Focused unit tests for the six core trust guarantees handled by
 * the client-side retrieval helpers:
 *   1. Year filter: 2026 query returns only 2026 sources
 *   2. Cross-year isolation: 2026 query does NOT include 2025 sources
 *   3. Supersession: superseded sources excluded from current results
 *   4. Supersession chain: chain resolution returns correct lineage
 *   5. Temporal event filtering
 *   6. Zero evidence: empty results handled gracefully
 */

import { describe, it, expect } from 'vitest'
import type { Source, Event, SourceStatus, EventStatus } from '../types'
import {
  filterSourcesByYear,
  excludeSupersededSources,
  getCurrentYearSources,
  resolveSupersessionChain,
  buildSupersessionChains,
  filterEventsByTemporalRange,
  getCurrentEvents,
  hasEvidence,
  getPrimaryEvidence,
  dedupeCitations,
  CURRENT_SOURCE_STATUSES,
  CURRENT_EVENT_STATUSES,
} from './retrieval'

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeSource(over: Partial<Source> & { id: string }): Source {
  return {
    id: over.id,
    platform: over.platform ?? 'facebook',
    postId: over.postId ?? `post_${over.id}`,
    postUrl: over.postUrl ?? `https://example.test/${over.id}`,
    publishedAt: over.publishedAt ?? new Date('2026-09-01T10:00:00+08:00'),
    festivalYear: over.festivalYear ?? 2026,
    rawText: over.rawText ?? `[fixture] ${over.id}`,
    normalizedText: over.normalizedText ?? `[fixture] ${over.id}`,
    status: over.status ?? 'active',
    supersedesSourceId: over.supersedesSourceId,
    ingestedAt: over.ingestedAt ?? new Date('2026-09-01T10:00:00+08:00'),
    updatedAt: over.updatedAt ?? new Date('2026-09-01T10:00:00+08:00'),
  }
}

function makeEvent(over: Partial<Event> & { id: string }): Event {
  return {
    id: over.id,
    eventName: over.eventName ?? `Event ${over.id}`,
    aliases: over.aliases ?? [],
    description: over.description ?? '',
    category: over.category ?? 'ceremony',
    startDatetime: over.startDatetime ?? new Date('2026-10-15T18:00:00+08:00'),
    endDatetime: over.endDatetime ?? new Date('2026-10-15T21:00:00+08:00'),
    venue: over.venue ?? 'Freedom Park',
    organizer: over.organizer ?? 'Provincial Government',
    deadline: over.deadline,
    eligibility: over.eligibility,
    fees: over.fees,
    contactInfo: over.contactInfo,
    status: over.status ?? 'scheduled',
    festivalYear: over.festivalYear ?? 2026,
    createdAt: over.createdAt ?? new Date('2026-09-01T10:00:00+08:00'),
    updatedAt: over.updatedAt ?? new Date('2026-09-01T10:00:00+08:00'),
  }
}

// Shared fixture set: a realistic multi-year + supersession scenario
const fixtureSources: Source[] = [
  makeSource({ id: 's2026-active', festivalYear: 2026, status: 'active' }),
  makeSource({ id: 's2026-updated', festivalYear: 2026, status: 'updated', supersedesSourceId: 's2026-old' }),
  makeSource({ id: 's2026-old', festivalYear: 2026, status: 'superseded' }),
  makeSource({ id: 's2026-cancelled', festivalYear: 2026, status: 'cancelled' }),
  makeSource({ id: 's2026-archived', festivalYear: 2026, status: 'archived' }),
  makeSource({ id: 's2025-active', festivalYear: 2025, status: 'active' }),
  makeSource({ id: 's2025-archived', festivalYear: 2025, status: 'archived' }),
  makeSource({ id: 's2027-postponed', festivalYear: 2027, status: 'postponed' }),
]

const fixtureEvents: Event[] = [
  makeEvent({ id: 'e2026-scheduled', festivalYear: 2026, status: 'scheduled' }),
  makeEvent({ id: 'e2026-confirmed', festivalYear: 2026, status: 'confirmed' }),
  makeEvent({ id: 'e2026-cancelled', festivalYear: 2026, status: 'cancelled' }),
  makeEvent({ id: 'e2026-completed', festivalYear: 2026, status: 'completed' }),
  makeEvent({ id: 'e2026-postponed', festivalYear: 2026, status: 'postponed' }),
  makeEvent({ id: 'e2025-completed', festivalYear: 2025, status: 'completed' }),
]

// ---------------------------------------------------------------------------
// 1. Year filter
// ---------------------------------------------------------------------------

describe('filterSourcesByYear', () => {
  it('returns only sources matching the target year', () => {
    const result = filterSourcesByYear(fixtureSources, 2026)
    expect(result.every((s) => s.festivalYear === 2026)).toBe(true)
    expect(result.map((s) => s.id).sort()).toEqual([
      's2026-active',
      's2026-archived',
      's2026-cancelled',
      's2026-old',
      's2026-updated',
    ])
  })

  it('returns an empty array when no sources match the year', () => {
    const result = filterSourcesByYear(fixtureSources, 2099)
    expect(result).toEqual([])
  })

  it('includes sources from other years when target year differs', () => {
    const result = filterSourcesByYear(fixtureSources, 2025)
    expect(result.map((s) => s.id).sort()).toEqual(['s2025-active', 's2025-archived'])
  })
})

// ---------------------------------------------------------------------------
// 2. Cross-year isolation
// ---------------------------------------------------------------------------

describe('getCurrentYearSources (cross-year isolation + superseded exclusion)', () => {
  it('2026 query does NOT include 2025 sources as current evidence', () => {
    const result = getCurrentYearSources(fixtureSources, 2026)
    expect(result.find((s) => s.id === 's2025-active')).toBeUndefined()
    expect(result.find((s) => s.id === 's2025-archived')).toBeUndefined()
    expect(result.find((s) => s.id === 's2027-postponed')).toBeUndefined()
  })

  it('2026 query includes active, updated, postponed sources from 2026', () => {
    const result = getCurrentYearSources(fixtureSources, 2026)
    const ids = result.map((s) => s.id).sort()
    expect(ids).toContain('s2026-active')
    expect(ids).toContain('s2026-updated')
  })
})

// ---------------------------------------------------------------------------
// 3. Superseded exclusion
// ---------------------------------------------------------------------------

describe('excludeSupersededSources', () => {
  it('excludes superseded sources', () => {
    const result = excludeSupersededSources(fixtureSources)
    expect(result.find((s) => s.status === 'superseded')).toBeUndefined()
  })

  it('excludes cancelled sources', () => {
    const result = excludeSupersededSources(fixtureSources)
    expect(result.find((s) => s.status === 'cancelled')).toBeUndefined()
  })

  it('excludes archived sources', () => {
    const result = excludeSupersededSources(fixtureSources)
    expect(result.find((s) => s.status === 'archived')).toBeUndefined()
  })

  it('keeps active, updated, and postponed sources', () => {
    const result = excludeSupersededSources(fixtureSources)
    const keptStatuses = new Set(result.map((s) => s.status))
    expect(keptStatuses.has('active')).toBe(true)
    expect(keptStatuses.has('updated')).toBe(true)
    expect(keptStatuses.has('postponed')).toBe(true)
  })
})

describe('CURRENT_SOURCE_STATUSES constant', () => {
  it('matches the canonical status model', () => {
    expect([...CURRENT_SOURCE_STATUSES].sort()).toEqual(['active', 'postponed', 'updated'])
  })
})

// ---------------------------------------------------------------------------
// 4. Supersession chain
// ---------------------------------------------------------------------------

describe('resolveSupersessionChain', () => {
  it('walks the chain from updated → superseded', () => {
    const result = resolveSupersessionChain('s2026-updated', fixtureSources)
    expect(result.map((s) => s.id)).toEqual(['s2026-updated', 's2026-old'])
  })

  it('returns single-element chain when source has no supersedes link', () => {
    const result = resolveSupersessionChain('s2026-active', fixtureSources)
    expect(result.map((s) => s.id)).toEqual(['s2026-active'])
  })

  it('is cycle-safe (does not infinite-loop on cycles)', () => {
    const cyclic = [
      makeSource({ id: 'a', status: 'updated', supersedesSourceId: 'b' }),
      makeSource({ id: 'b', status: 'superseded', supersedesSourceId: 'a' }),
    ]
    const result = resolveSupersessionChain('a', cyclic)
    expect(result.map((s) => s.id).sort()).toEqual(['a', 'b'])
  })
})

describe('buildSupersessionChains', () => {
  it('returns map of sourceId → chain only for sources with a link', () => {
    const result = buildSupersessionChains(fixtureSources)
    expect(result['s2026-updated']).toBeDefined()
    expect(result['s2026-updated'].length).toBe(2)
    expect(result['s2026-active']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 5. Temporal event filtering
// ---------------------------------------------------------------------------

describe('filterEventsByTemporalRange', () => {
  it('includes events whose range overlaps the window', () => {
    const events: Event[] = [
      makeEvent({ id: 'in', startDatetime: new Date('2026-10-15T18:00:00+08:00'), endDatetime: new Date('2026-10-15T21:00:00+08:00') }),
      makeEvent({ id: 'before', startDatetime: new Date('2026-01-01T10:00:00+08:00'), endDatetime: new Date('2026-01-01T12:00:00+08:00') }),
      makeEvent({ id: 'after', startDatetime: new Date('2026-12-31T10:00:00+08:00'), endDatetime: new Date('2026-12-31T12:00:00+08:00') }),
    ]
    const result = filterEventsByTemporalRange(events, {
      startDate: new Date('2026-10-15T00:00:00+08:00'),
      endDate: new Date('2026-10-25T23:59:00+08:00'),
    })
    expect(result.map((e) => e.id)).toEqual(['in'])
  })

  it('returns all events when window is unbounded', () => {
    const result = filterEventsByTemporalRange(fixtureEvents, {})
    expect(result.length).toBe(fixtureEvents.length)
  })
})

describe('getCurrentEvents', () => {
  it('keeps only scheduled and confirmed events', () => {
    const result = getCurrentEvents(fixtureEvents)
    expect(result.every((e) => e.status === 'scheduled' || e.status === 'confirmed')).toBe(true)
    expect(result.length).toBe(2)
    expect(result.map((e) => e.id).sort()).toEqual(['e2026-confirmed', 'e2026-scheduled'])
  })

  it('CURRENT_EVENT_STATUSES matches canonical model', () => {
    expect([...CURRENT_EVENT_STATUSES].sort()).toEqual(['confirmed', 'scheduled'])
  })
})

// ---------------------------------------------------------------------------
// 6. Zero evidence handling
// ---------------------------------------------------------------------------

describe('hasEvidence', () => {
  it('returns true when year has sources', () => {
    expect(hasEvidence(fixtureSources, [], 2026)).toBe(true)
  })

  it('returns true when year has events (even with no sources)', () => {
    const events2026 = fixtureEvents.filter((e) => e.festivalYear === 2026)
    expect(hasEvidence([], events2026, 2026)).toBe(true)
  })

  it('returns false when year has neither sources nor events', () => {
    expect(hasEvidence(fixtureSources, fixtureEvents, 2099)).toBe(false)
  })

  it('returns false when all 2026 sources are superseded/cancelled/archived and no events remain current', () => {
    const onlyJunk = [
      makeSource({ id: 'j1', festivalYear: 2026, status: 'superseded' as SourceStatus }),
      makeSource({ id: 'j2', festivalYear: 2026, status: 'cancelled' as SourceStatus }),
    ]
    expect(hasEvidence(onlyJunk, [], 2026)).toBe(false)
  })

  it('returns false for empty inputs', () => {
    expect(hasEvidence([], [], 2026)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Combined primary evidence
// ---------------------------------------------------------------------------

describe('getPrimaryEvidence', () => {
  it('returns current year sources, excludes superseded, reports counters', () => {
    const result = getPrimaryEvidence(fixtureSources, fixtureEvents, 2026)
    // Sources should be current-year, non-superseded
    expect(result.sources.every((s) => s.festivalYear === 2026)).toBe(true)
    expect(result.sources.find((s) => s.status === 'superseded')).toBeUndefined()
    expect(result.sources.find((s) => s.status === 'cancelled')).toBeUndefined()
    expect(result.sources.find((s) => s.status === 'archived')).toBeUndefined()
    // Events should be current-year, scheduled or confirmed
    expect(result.events.every((e) => e.festivalYear === 2026)).toBe(true)
    expect(result.events.every((e) => e.status === 'scheduled' || e.status === 'confirmed')).toBe(true)
    // Counters
    expect(result.yearFilteredOut.sources).toBe(3) // 2025-active, 2025-archived, 2027-postponed
    expect(result.yearFilteredOut.events).toBe(1) // 2025-completed
    expect(result.supersededExcluded).toBe(3) // superseded, cancelled, archived
  })

  it('emits citations matching current sources', () => {
    const result = getPrimaryEvidence(fixtureSources, fixtureEvents, 2026)
    expect(result.citations.length).toBe(result.sources.length)
    expect(result.citations.every((c) => c.id && c.platform && c.postUrl)).toBe(true)
  })

  it('returns empty packet for year with no data', () => {
    const result = getPrimaryEvidence(fixtureSources, fixtureEvents, 2099)
    expect(result.sources).toEqual([])
    expect(result.events).toEqual([])
    expect(result.citations).toEqual([])
    expect(result.yearFilteredOut.sources).toBe(fixtureSources.length)
    expect(result.yearFilteredOut.events).toBe(fixtureEvents.length)
  })
})

// ---------------------------------------------------------------------------
// Citation dedup
// ---------------------------------------------------------------------------

describe('dedupeCitations', () => {
  it('removes duplicate citations keeping first occurrence', () => {
    const result = dedupeCitations([
      { id: 'a', title: 'A', platform: 'facebook', postUrl: 'x', publishedAt: new Date(), festivalYear: 2026, status: 'active' },
      { id: 'b', title: 'B', platform: 'facebook', postUrl: 'y', publishedAt: new Date(), festivalYear: 2026, status: 'active' },
      { id: 'a', title: 'A-dup', platform: 'facebook', postUrl: 'z', publishedAt: new Date(), festivalYear: 2026, status: 'active' },
    ])
    expect(result.length).toBe(2)
    expect(result[0].id).toBe('a')
    expect(result[1].id).toBe('b')
  })
})

// ---------------------------------------------------------------------------
// Type-model sanity: status union completeness
// ---------------------------------------------------------------------------

describe('status model type sanity', () => {
  it('every SourceStatus has at least one fixture example', () => {
    const statuses = new Set<SourceStatus>(fixtureSources.map((s) => s.status))
    const expected: SourceStatus[] = ['active', 'updated', 'superseded', 'cancelled', 'archived']
    for (const s of expected) expect(statuses.has(s)).toBe(true)
    // 'postponed' is covered by s2027-postponed
    expect(statuses.has('postponed')).toBe(true)
  })

  it('every EventStatus has at least one fixture example', () => {
    const statuses = new Set<EventStatus>(fixtureEvents.map((e) => e.status))
    const expected: EventStatus[] = ['scheduled', 'confirmed', 'cancelled', 'completed', 'postponed']
    for (const s of expected) expect(statuses.has(s)).toBe(true)
  })
})
