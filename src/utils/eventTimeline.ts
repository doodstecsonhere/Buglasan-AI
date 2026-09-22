/**
 * Buglasan AI - Generic event-timeline suggestion selection
 *
 * Provider-independent, deterministic timeline logic shared by any event
 * deployment (Buglasan now, E-AI-E later). It knows nothing about festival
 * copy: each event supplies its own window, override days, finale day, and
 * per-phase suggestion sets. Only the selection order and the timezone-safe
 * local-day comparison live here.
 */

export interface EventTimelineConfig {
  /** IANA zone the event is observed in; all day math uses this zone, never the host clock. */
  readonly timeZone: string
  /** Inclusive festival window as YYYY-MM-DD calendar days in `timeZone`. */
  readonly startIsoDay: string
  readonly endIsoDay: string
  /** Optional final-day set (e.g. closing day) checked before `duringIsoDays`. */
  readonly finaleIsoDay?: string
  /** Optional per-day overrides within the window (e.g. headline Fri/Sat days). */
  readonly specialIsoDays?: readonly string[]
  /** Optional plain in-window days that override `specialIsoDays` (e.g. the opening day). */
  readonly duringIsoDays?: readonly string[]
  readonly before: readonly string[]
  readonly during: readonly string[]
  readonly special?: readonly string[]
  readonly finale?: readonly string[]
  readonly after: readonly string[]
}

export type EventTimelinePhase = 'before' | 'during' | 'special' | 'finale' | 'after'

/** Calendar day (YYYY-MM-DD) of an instant as observed in `timeZone`. */
export function localIsoDay(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant)
  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value
  if (!year || !month || !day) throw new Error(`eventTimeline: could not resolve calendar day for time zone ${timeZone}`)
  return `${year}-${month}-${day}`
}

export function resolveEventTimelinePhase(config: EventTimelineConfig, isoDay: string): EventTimelinePhase {
  if (isoDay < config.startIsoDay) return 'before'
  if (isoDay > config.endIsoDay) return 'after'
  // Explicit-phase days win over pattern overrides, which win over the plain in-window default.
  if (config.duringIsoDays?.includes(isoDay)) return 'during'
  if (config.finaleIsoDay && isoDay === config.finaleIsoDay) return 'finale'
  if (config.specialIsoDays?.includes(isoDay)) return 'special'
  return 'during'
}

/**
 * Exactly three prompt strings for the instant `now`, selected purely from
 * the configured calendar in `config.timeZone`. Deterministic: same instant +
 * same config always returns the same set on any host timezone.
 */
export function eventTimelineSuggestions(config: EventTimelineConfig, now: Date): readonly string[] {
  const phase = resolveEventTimelinePhase(config, localIsoDay(now, config.timeZone))
  const set = phase === 'special' ? config.special : phase === 'finale' ? config.finale : config[phase]
  if (!set || set.length !== 3) throw new Error(`eventTimeline: phase '${phase}' must configure exactly 3 suggestions`)
  return set
}
