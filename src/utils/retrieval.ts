/**
 * Buglasan AI - Client-side Retrieval Helpers
 *
 * Phase 6: Pure helpers extracted from chatService so they can be tested
 * in isolation. These mirror the server-side filters used by the
 * Supabase Edge Function but run entirely in-memory against the demo
 * dataset (or any list of Source / Event records).
 *
 * Six core trust guarantees covered here:
 *   1. Cross-year isolation    — filterSourcesByYear()
 *   2. Superseded exclusion    — excludeSupersededSources()
 *   3. Supersession chain      — resolveSupersessionChain()
 *   4. Temporal event filter   — filterEventsByTemporalRange()
 *   5. Zero evidence handling  — hasEvidence()
 *   6. Combined primary set    — getPrimaryEvidence()
 *
 * All functions are pure (no I/O, no globals) — easy to test.
 */

import type { Source, Event, SourceCitation, FestivalYear } from '../types'

// ---------------------------------------------------------------------------
// Constants — keep in sync with src/types/index.ts status model.
// ---------------------------------------------------------------------------

export const CURRENT_SOURCE_STATUSES = ['active', 'updated', 'postponed'] as const
export const CURRENT_EVENT_STATUSES = ['scheduled', 'confirmed'] as const

// ---------------------------------------------------------------------------
// 1. Cross-year isolation
// ---------------------------------------------------------------------------

/**
 * Return only sources whose `festivalYear` matches the target year.
 * Trust guarantee: a 2026 query must never pull 2025 sources as
 * "current evidence" — even if they share a platform or topic.
 */
export function filterSourcesByYear(sources: Source[], targetYear: FestivalYear): Source[] {
  return sources.filter((s) => s.festivalYear === targetYear)
}

// ---------------------------------------------------------------------------
// 2. Superseded exclusion
// ---------------------------------------------------------------------------

/**
 * Exclude sources whose status is 'superseded', 'cancelled', or 'archived'.
 * Trust guarantee: superseded sources are NEVER primary evidence.
 */
export function excludeSupersededSources(sources: Source[]): Source[] {
  return sources.filter((s) => !['superseded', 'cancelled', 'archived'].includes(s.status))
}

/**
 * Combined: year filter + superseded exclusion. This is what gets passed
 * to the LLM as "current evidence" for the target year.
 */
export function getCurrentYearSources(sources: Source[], targetYear: FestivalYear): Source[] {
  return excludeSupersededSources(filterSourcesByYear(sources, targetYear))
}

// ---------------------------------------------------------------------------
// 3. Supersession chain resolution
// ---------------------------------------------------------------------------

/**
 * Walk the supersession chain for a given source. Returns all ancestors
 * (the source itself + sources it supersedes + sources they supersede, etc.)
 * in order from newest → oldest.
 *
 * Cycle-safe: tracks visited ids and stops on repeat.
 */
export function resolveSupersessionChain(
  sourceId: string,
  sources: Source[]
): Source[] {
  const byId = new Map(sources.map((s) => [s.id, s]))
  const chain: Source[] = []
  const visited = new Set<string>()
  let current = byId.get(sourceId)

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    chain.push(current)
    if (current.supersedesSourceId) {
      current = byId.get(current.supersedesSourceId)
    } else {
      current = undefined
    }
  }

  return chain
}

/**
 * Map an array of sources to { sourceId -> chain[] } for every source that
 * has a supersedesSourceId. Sources without a link are omitted.
 */
export function buildSupersessionChains(
  sources: Source[]
): Record<string, Source[]> {
  const out: Record<string, Source[]> = {}
  for (const s of sources) {
    if (s.supersedesSourceId) {
      const chain = resolveSupersessionChain(s.id, sources)
      if (chain.length > 1) {
        out[s.id] = chain
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 4. Temporal event filtering
// ---------------------------------------------------------------------------

/**
 * Filter events to those whose [startDatetime, endDatetime] overlap the
 * supplied window. Used for "upcoming" / "this weekend" / date-range queries.
 */
export function filterEventsByTemporalRange(
  events: Event[],
  window: { startDate?: Date; endDate?: Date }
): Event[] {
  const start = window.startDate?.getTime() ?? Number.NEGATIVE_INFINITY
  const end = window.endDate?.getTime() ?? Number.POSITIVE_INFINITY
  return events.filter((e) => {
    const eStart = new Date(e.startDatetime).getTime()
    const eEnd = new Date(e.endDatetime).getTime()
    return eEnd >= start && eStart <= end
  })
}

/**
 * Return only events that are "current" per the canonical status model.
 */
export function getCurrentEvents(events: Event[]): Event[] {
  return events.filter((e) => CURRENT_EVENT_STATUSES.includes(e.status as typeof CURRENT_EVENT_STATUSES[number]))
}

// ---------------------------------------------------------------------------
// 5. Zero evidence handling
// ---------------------------------------------------------------------------

/**
 * Quick predicate: do we have ANY current evidence for the given year?
 * If false, the UI/service should emit a "no information found" message
 * rather than fabricating an answer.
 */
export function hasEvidence(
  sources: Source[],
  events: Event[],
  targetYear: FestivalYear
): boolean {
  const yearSources = getCurrentYearSources(sources, targetYear)
  const yearEvents = getCurrentEvents(
    events.filter((e) => e.festivalYear === targetYear)
  )
  return yearSources.length > 0 || yearEvents.length > 0
}

// ---------------------------------------------------------------------------
// 6. Combined primary evidence packet
// ---------------------------------------------------------------------------

export interface PrimaryEvidence {
  sources: Source[]
  events: Event[]
  citations: SourceCitation[]
  yearFilteredOut: { sources: number; events: number }
  supersededExcluded: number
}

/**
 * Build the primary evidence packet for a query.
 *
 * - Filters to the target year (cross-year isolation)
 * - Excludes superseded / cancelled / archived
 * - Emits citations ready for the UI
 * - Reports counters so callers can produce honest "X items filtered" notes
 */
export function getPrimaryEvidence(
  sources: Source[],
  events: Event[],
  targetYear: FestivalYear
): PrimaryEvidence {
  const yearSources = filterSourcesByYear(sources, targetYear)
  const yearEvents = events.filter((e) => e.festivalYear === targetYear)

  const currentSources = excludeSupersededSources(yearSources)
  const currentEvents = getCurrentEvents(yearEvents)

  const supersededExcluded = yearSources.length - currentSources.length
  const yearFilteredOut = {
    sources: sources.length - yearSources.length,
    events: events.length - yearEvents.length,
  }

  const citations: SourceCitation[] = currentSources.map((s) => ({
    id: s.id,
    title: s.normalizedText.substring(0, 100),
    platform: s.platform,
    postUrl: s.postUrl,
    publishedAt: s.publishedAt,
    festivalYear: s.festivalYear,
    status: s.status,
    supersedesSourceId: s.supersedesSourceId,
  }))

  return {
    sources: currentSources,
    events: currentEvents,
    citations,
    yearFilteredOut,
    supersededExcluded,
  }
}

// ---------------------------------------------------------------------------
// Citation helpers
// ---------------------------------------------------------------------------

/**
 * Deduplicate citations by source id (first wins).
 */
export function dedupeCitations(citations: SourceCitation[]): SourceCitation[] {
  const seen = new Set<string>()
  const out: SourceCitation[] = []
  for (const c of citations) {
    if (!seen.has(c.id)) {
      seen.add(c.id)
      out.push(c)
    }
  }
  return out
}
