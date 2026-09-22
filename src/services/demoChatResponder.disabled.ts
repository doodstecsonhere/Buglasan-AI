import type { Event, FestivalYear, Source } from '../types'

/** Production stub: Vite aliases the fixture responder here for live builds. */
export function createDemoResponse(
  _query: string,
  _year: FestivalYear,
  _sources: Source[],
  _events: Event[],
  _language: 'en' | 'ceb' | 'fil'
): string {
  throw new Error('Demo responses are unavailable in this build.')
}
