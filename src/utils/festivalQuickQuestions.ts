/**
 * Buglasan AI - Buglasan-specific timeline-aware quick questions
 *
 * Keeps only Buglasan 2026 knowledge here (window dates, headline Fri/Sat days,
 * finale day, and the exact chip copy). Selection logic and the Asia/Manila
 * day math come from the generic eventTimeline helper, so E-AI-E can reuse the
 * same machinery with its own config later. The festival window and timezone
 * are read from product config (eventCycle/regional) instead of being
 * duplicated here.
 */

import { productConfig } from '../config/productConfig'
import { eventTimelineSuggestions, localIsoDay, type EventTimelineConfig } from './eventTimeline'

const pad = (value: number): string => String(value).padStart(2, '0')
const isoDay = (year: number, monthIndex: number, day: number): string => `${year}-${pad(monthIndex + 1)}-${pad(day)}`

const { typicalStart, typicalEnd } = productConfig.eventCycle

// Buglasan 2026 headline Fri/Sat days (Source #37 official schedule anchors).
// Month/day pairs so the same anchors map onto any festival year the helper is asked about.
const SPECIAL_MONTH_DAYS: readonly { readonly monthIndex: number; readonly day: number }[] = [
  { monthIndex: 9, day: 16 }, { monthIndex: 9, day: 17 }, { monthIndex: 9, day: 23 }, { monthIndex: 9, day: 24 },
]

export const buglasanBeforeSuggestions = Object.freeze(['Show me the full schedule', 'What are the biggest events?', 'When does Buglasan start?'] as const)
export const buglasanDuringSuggestions = Object.freeze(['What’s happening today?', 'What’s happening tonight?', 'What’s happening tomorrow?'] as const)
export const buglasanSpecialSuggestions = Object.freeze(['What’s happening today?', 'What’s happening this weekend?', 'When are the fireworks?'] as const)
export const buglasanFinaleSuggestions = Object.freeze(['What’s happening today?', 'When is the Kapamilya Caravan?', 'When are the closing fireworks?'] as const)
export const buglasanAfterSuggestions = Object.freeze(['What happened at Buglasan 2026?', 'Show me the 2026 schedule', 'What were the major events?'] as const)

/**
 * Builds the timeline config for one festival year. The window comes from
 * product config; Oct 15 keeps the normal in-festival set even though it is a
 * Friday, so the opening day is pinned as a plain during-window day.
 */
export function buglasanEventTimelineConfig(year: number): EventTimelineConfig {
  return {
    timeZone: productConfig.regional.timeZone,
    startIsoDay: isoDay(year, typicalStart.monthIndex, typicalStart.day),
    endIsoDay: isoDay(year, typicalEnd.monthIndex, typicalEnd.day),
    finaleIsoDay: isoDay(year, typicalEnd.monthIndex, typicalEnd.day),
    specialIsoDays: SPECIAL_MONTH_DAYS.map(point => isoDay(year, point.monthIndex, point.day)),
    duringIsoDays: [isoDay(year, typicalStart.monthIndex, typicalStart.day)],
    before: buglasanBeforeSuggestions,
    during: buglasanDuringSuggestions,
    special: buglasanSpecialSuggestions,
    finale: buglasanFinaleSuggestions,
    after: buglasanAfterSuggestions,
  }
}

/**
 * The three empty-state quick questions for the Buglasan calendar at any
 * instant. Only the absolute instant and the configured Asia/Manila zone are
 * consulted (never host-local Date getters), so a device in another timezone
 * cannot shift the festival day; the default is the real current time.
 */
export function getFestivalQuickQuestions(now: Date = new Date()): readonly string[] {
  const festivalDay = localIsoDay(now, productConfig.regional.timeZone)
  return eventTimelineSuggestions(buglasanEventTimelineConfig(Number(festivalDay.slice(0, 4))), now)
}
