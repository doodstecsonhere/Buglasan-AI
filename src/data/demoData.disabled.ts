/**
 * Production-only demo-data boundary.
 *
 * Vite aliases `demoData.ts` to this module when building with
 * VITE_DEMO_MODE=false. Keep this module free of synthetic fixture values so
 * the production graph has no route to demo facts.
 */
import type { Event, EventSource, FestivalYear, Message, Source } from '../types'
import { getCurrentFestivalYear } from '../utils/dateUtils'

export const currentYear = getCurrentFestivalYear()
export const previousYear = currentYear - 1
export const historicalYear = currentYear - 2

export const demoSources: Source[] = []
export const demoEvents: Event[] = []
export const demoEventSources: EventSource[] = []
export const demoMessages: Message[] = []
export const demoQuickQuestions: string[] = []

export function isDemoFixture(_text: string | undefined | null): boolean {
  return false
}

export function getSourcesForYear(_year: FestivalYear): Source[] {
  return []
}

export function getEventsForYear(_year: FestivalYear): Event[] {
  return []
}

export function getCurrentSourcesForYear(_year: FestivalYear): Source[] {
  return []
}

export function getCurrentEventsForYear(_year: FestivalYear): Event[] {
  return []
}

export function getSourcesForEvent(_eventId: string): Source[] {
  return []
}

export function getPrimarySourcesForEvent(_eventId: string): Source[] {
  return []
}

export function getVenueSourceForEvent(_eventId: string): Source | undefined {
  return undefined
}

export function getOrganizerSourceForEvent(_eventId: string): Source | undefined {
  return undefined
}
