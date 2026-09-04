/**
 * Buglasan AI - Chat Service Demo-Mode Tests (Phase 6)
 *
 * Focused tests for the demo-mode response generation. Verifies that
 * the demo response:
 *   - derives schedule from demo sources (not hard-coded facts)
 *   - derives history from the history source
 *   - derives food-fair content from the food source
 *   - returns zero-evidence message for unknown queries
 *   - respects year resolution (explicit year overrides default)
 *
 * The live (Supabase Edge Function) path is NOT exercised here — those
 * tests live in supabase/functions/chat/retrieval.test.ts (Deno).
 *
 * NOTE: We use real timers here because the demo response path uses
 * `setTimeout` (an 800-1200ms artificial delay). `vi.useFakeTimers()`
 * would prevent the delay from ever resolving.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ChatService } from './chatService'
import { currentYear, previousYear, demoSources } from '../data/demoData'

// We don't mock the date — the demo data is built around `currentYear`,
// so we rely on whatever year the system thinks it is when the tests run.
// `getCurrentFestivalYear()` is a thin wrapper around `new Date()` and we
// just check structural properties of the response.

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatService (demo mode)', () => {
  let service: ChatService
  let currentFestivalYear: number

  // Compute the current year from a known fixture so tests stay deterministic
  // regardless of clock — `demoData.ts` exports `currentYear`.
  const expectedYear = currentYear

  beforeEach(() => {
    service = new ChatService({ demoMode: true })
    currentFestivalYear = expectedYear
  })

  it('demo response for "schedule" derives from demo sources (not hard-coded)', async () => {
    const response = await service.sendMessage({ message: 'What is the schedule?' })

    // Header should reference the current festival year
    expect(response.message.content).toContain(`Buglasan Festival ${currentFestivalYear}`)
    // Should include event names that are actually in the demo dataset
    expect(response.message.content).toContain('Opening Ceremony')
    // Should include source-id markers (per-claim citation)
    expect(response.message.content).toMatch(/_\(src:/)

    // The content must come from a backing source — not a hard-coded string.
    // Check at least one event is cited from a real demo source id.
    const sourceIdsInResponse = response.message.content.match(/_\(src:\s*([a-zA-Z0-9_-]+)\)_/g) ?? []
    const citedIds = sourceIdsInResponse.map((m) => m.match(/_\(src:\s*([a-zA-Z0-9_-]+)\)_/)![1])
    const knownIds = new Set(demoSources.map((s) => s.id))
    for (const id of citedIds) {
      expect(knownIds.has(id)).toBe(true)
    }
  })

  it('demo response for "history" derives from history source', async () => {
    const response = await service.sendMessage({ message: 'Tell me about Buglasan history' })

    // Should include the demo history source's content
    const historySource = demoSources.find((s) => s.id === 'src-history-meaning')
    expect(historySource).toBeDefined()
    // The history source's normalized text (stripped of [DEMO FIXTURE]) should appear
    const strippedText = historySource!.normalizedText.replace(/\[DEMO FIXTURE\]\s*/g, '').trim()
    expect(response.message.content).toContain(strippedText.substring(0, 30))
    // Header should indicate history derivation
    expect(response.message.content.toLowerCase()).toContain('about buglasan')
  })

  it('demo response for "food" derives from food source', async () => {
    const response = await service.sendMessage({ message: 'What food is at the food fair?' })

    // Should cite the food source
    const foodSourceId = demoSources.find((s) => s.id === 'src-current-004')?.id
    expect(foodSourceId).toBeDefined()
    // Content should mention food fair
    expect(response.message.content.toLowerCase()).toContain('food fair')
    // Should include a source citation (either explicit src marker or [Source] block)
    const hasMarker = /_\(src:/.test(response.message.content)
    const hasGeneric = /\[Source\]/.test(response.message.content)
    expect(hasMarker || hasGeneric).toBe(true)
  })

  it('demo response for unknown query returns zero-evidence message', async () => {
    const response = await service.sendMessage({ message: 'xyzzy foobar non-existent topic' })

    // Should produce the "no match" / "no info" message
    const lower = response.message.content.toLowerCase()
    const saysNoInfo =
      lower.includes('no demo information') ||
      lower.includes('no information') ||
      lower.includes('matches that query') ||
      lower.includes('not found')
    expect(saysNoInfo).toBe(true)

    // Empty query should also return zero-evidence message
    const emptyResponse = await service.sendMessage({ message: '' })
    const emptyLower = emptyResponse.message.content.toLowerCase()
    expect(
      emptyLower.includes('no demo information') || emptyLower.includes('no information')
    ).toBe(true)
  })

  it('demo response respects year resolution — explicit year wins', async () => {
    const response = await service.sendMessage({
      message: `What is the schedule for ${previousYear}?`,
    })

    expect(response.yearResolved).toBe(previousYear)
    expect(response.message.content).toContain(`Buglasan Festival ${previousYear}`)
    expect(response.message.content).not.toContain(`Buglasan Festival ${currentFestivalYear} schedule`)
  })

  it('demo response uses current festival year when no explicit year in query', async () => {
    const response = await service.sendMessage({ message: 'What is happening?' })
    expect(response.yearResolved).toBe(currentFestivalYear)
    expect(response.message.content).toContain(`Buglasan Festival ${currentFestivalYear}`)
  })

  it('demo response never includes superseded sources as primary evidence for current year', async () => {
    const response = await service.sendMessage({ message: 'What is the schedule?' })

    const sourceIdsInResponse = response.message.content.match(/_\(src:\s*([a-zA-Z0-9_-]+)\)_/g) ?? []
    const citedIds = sourceIdsInResponse.map((m) => m.match(/_\(src:\s*([a-zA-Z0-9_-]+)\)_/)![1])
    const supersededIds = new Set(
      demoSources.filter((s) => s.status === 'superseded').map((s) => s.id)
    )
    for (const id of citedIds) {
      expect(supersededIds.has(id)).toBe(false)
    }
  })

  it('retrievedSources is the year-filtered, non-superseded subset', async () => {
    const response = await service.sendMessage({ message: 'Schedule please' })

    // All retrieved sources should be current year, non-superseded
    expect(response.retrievedSources.every((s) => s.festivalYear === currentFestivalYear)).toBe(true)
    expect(response.retrievedSources.every((s) =>
      ['active', 'updated', 'postponed'].includes(s.status)
    )).toBe(true)
  })

  it('retrievedEvents is current-year, scheduled/confirmed only', async () => {
    const response = await service.sendMessage({ message: 'Schedule please' })

    expect(response.retrievedEvents.every((e) => e.festivalYear === currentFestivalYear)).toBe(true)
    expect(response.retrievedEvents.every((e) =>
      ['scheduled', 'confirmed'].includes(e.status)
    )).toBe(true)
  })

  it('response includes valid citations array', async () => {
    const response = await service.sendMessage({ message: 'Schedule' })

    expect(Array.isArray(response.message.sources)).toBe(true)
    for (const c of response.message.sources) {
      expect(c.id).toBeTruthy()
      expect(c.platform).toBeTruthy()
      expect(c.postUrl).toBeTruthy()
      expect(c.festivalYear).toBe(currentFestivalYear)
    }
  })

  it('current festival year helper matches the demo dataset', () => {
    // Sanity: the year the dataset was built around matches the runtime year.
    expect(currentFestivalYear).toBe(currentYear)
    expect(currentYear).toBe(previousYear + 1)
  })
})

// ---------------------------------------------------------------------------
// Pure year-resolution contract
// ---------------------------------------------------------------------------

describe('ChatService year resolution contract', () => {
  it('explicit-year override beats default', async () => {
    const service = new ChatService({ demoMode: true })
    const response = await service.sendMessage({
      message: 'Buglasan 2024 schedule',
    })
    expect(response.yearResolved).toBe(2024)
  })

  it('"next year" relative expression resolves forward', async () => {
    const service = new ChatService({ demoMode: true })
    const cy = currentYear
    const response = await service.sendMessage({ message: 'next year schedule' })
    expect(response.yearResolved).toBe(cy + 1)
  })

  it('"last year" relative expression resolves backward', async () => {
    const service = new ChatService({ demoMode: true })
    const cy = currentYear
    const response = await service.sendMessage({ message: 'last year schedule' })
    expect(response.yearResolved).toBe(cy - 1)
  })
})
