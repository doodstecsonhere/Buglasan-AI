import { describe, expect, it } from 'vitest'
import { ChatInterface } from '../components/ChatInterface'
import { productConfig } from '../config/productConfig'
import {
  buglasanAfterSuggestions,
  buglasanBeforeSuggestions,
  buglasanDuringSuggestions,
  buglasanEventTimelineConfig,
  buglasanFinaleSuggestions,
  buglasanSpecialSuggestions,
  getFestivalQuickQuestions,
} from './festivalQuickQuestions'

const HOUR = 60 * 60 * 1000
// Local noon in Asia/Manila (UTC+8, no DST) for a given calendar day.
const manilaNoonUtc = (isoDayStr: string): Date => new Date(`${isoDayStr}T04:00:00.000Z`)
// Shift an instant so a host at `zoneOffsetHours` sees the same wall clock as Manila noon.
const hostNoon = (isoDayStr: string, zoneOffsetHours: number): Date => new Date(manilaNoonUtc(isoDayStr).getTime() - zoneOffsetHours * HOUR)

const questionsAt = (instant: Date): readonly string[] => getFestivalQuickQuestions(instant)

describe('Buglasan timeline quick questions — date matrix', () => {
  it('Oct 14 (before) shows the pre-festival set', () => {
    expect(questionsAt(manilaNoonUtc('2026-10-14'))).toEqual(buglasanBeforeSuggestions)
    expect(buglasanBeforeSuggestions).toEqual(['Show me the full schedule', 'What are the biggest events?', 'When does Buglasan start?'])
  })

  it('Oct 15 (opening Friday) keeps the normal active-festival set', () => {
    expect(questionsAt(manilaNoonUtc('2026-10-15'))).toEqual(buglasanDuringSuggestions)
    expect(buglasanDuringSuggestions).toEqual(['What’s happening today?', 'What’s happening tonight?', 'What’s happening tomorrow?'])
  })

  it.each(['2026-10-16', '2026-10-17', '2026-10-23', '2026-10-24'])('%s (headline Fri/Sat) shows the weekend set', day => {
    expect(questionsAt(manilaNoonUtc(day))).toEqual(buglasanSpecialSuggestions)
  })
  expect(buglasanSpecialSuggestions).toEqual(['What’s happening today?', 'What’s happening this weekend?', 'When are the fireworks?'])

  it.each(['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'])('%s (plain festival day) shows the normal set', day => {
    expect(questionsAt(manilaNoonUtc(day))).toEqual(buglasanDuringSuggestions)
  })

  it('Oct 25 (final day) shows the finale set', () => {
    expect(questionsAt(manilaNoonUtc('2026-10-25'))).toEqual(buglasanFinaleSuggestions)
    expect(buglasanFinaleSuggestions).toEqual(['What’s happening today?', 'When is the Kapamilya Caravan?', 'When are the closing fireworks?'])
  })

  it('Oct 26 (after) shows the post-festival set', () => {
    expect(questionsAt(manilaNoonUtc('2026-10-26'))).toEqual(buglasanAfterSuggestions)
    expect(buglasanAfterSuggestions).toEqual(['What happened at Buglasan 2026?', 'Show me the 2026 schedule', 'What were the major events?'])
  })

  it.each(['2026-10-13', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'])('returns exactly three suggestions on %s', day => {
    expect(questionsAt(manilaNoonUtc(day))).toHaveLength(3)
  })
})

describe('Buglasan timeline quick questions — Asia/Manila midnight boundary', () => {
  it('picks the Oct 15 festival set the instant Manila crosses midnight, even while UTC is still Oct 14', () => {
    // 2026-10-15 00:00 in Dumaguete = 2026-10-14 16:00 UTC.
    expect(getFestivalQuickQuestions(new Date('2026-10-14T16:00:00.000Z'))).toEqual(buglasanDuringSuggestions)
    // One second earlier Manila is still Oct 14 — pre-festival.
    expect(getFestivalQuickQuestions(new Date('2026-10-14T15:59:59.000Z'))).toEqual(buglasanBeforeSuggestions)
  })

  it('holds the finale set until Manila midnight turns Oct 25 into Oct 26', () => {
    // 2026-10-25 23:59 in Dumaguete = 2026-10-25 15:59 UTC.
    expect(getFestivalQuickQuestions(new Date('2026-10-25T15:59:00.000Z'))).toEqual(buglasanFinaleSuggestions)
    // 2026-10-26 00:00 in Dumaguete = 2026-10-25 16:00 UTC.
    expect(getFestivalQuickQuestions(new Date('2026-10-25T16:00:00.000Z'))).toEqual(buglasanAfterSuggestions)
  })

  it('starts the weekend set at Manila midnight on Oct 16 and Oct 23', () => {
    expect(getFestivalQuickQuestions(new Date('2026-10-15T16:00:00.000Z'))).toEqual(buglasanSpecialSuggestions)
    expect(getFestivalQuickQuestions(new Date('2026-10-22T16:00:00.000Z'))).toEqual(buglasanSpecialSuggestions)
  })
})

describe('Buglasan timeline quick questions — host timezone independence', () => {
  // The helper consults only the absolute instant and the configured zone (Intl),
  // never host-local Date getters, so instants whose host-local calendar disagrees
  // with the Manila calendar must still resolve by the Manila day.
  it.each([
    ['2026-10-14', buglasanBeforeSuggestions],
    ['2026-10-15', buglasanDuringSuggestions],
    ['2026-10-16', buglasanSpecialSuggestions],
    ['2026-10-17', buglasanSpecialSuggestions],
    ['2026-10-18', buglasanDuringSuggestions],
    ['2026-10-23', buglasanSpecialSuggestions],
    ['2026-10-24', buglasanSpecialSuggestions],
    ['2026-10-25', buglasanFinaleSuggestions],
    ['2026-10-26', buglasanAfterSuggestions],
  ] as const)('%s yields the same set for UTC-5-, UTC-, and UTC+9-hosted wall-clock instants', (day: string, expected: readonly string[]) => {
    for (const offset of [-5, 0, 9]) {
      expect(getFestivalQuickQuestions(hostNoon(day, offset))).toEqual(expected)
    }
    expect(getFestivalQuickQuestions(manilaNoonUtc(day))).toEqual(expected)
  })
})

describe('Buglasan timeline quick questions — product config parity', () => {
  it('derives the festival window and timezone from product config instead of diverging', () => {
    const config = buglasanEventTimelineConfig(2026)
    expect(config.timeZone).toBe(productConfig.regional.timeZone)
    expect(config.timeZone).toBe('Asia/Manila')
    // eventCycle.typicalStart/End is the Oct 15–25 window pinned by productConfig.test P4.
    expect(config.startIsoDay).toBe(`2026-${String(productConfig.eventCycle.typicalStart.monthIndex + 1).padStart(2, '0')}-${String(productConfig.eventCycle.typicalStart.day).padStart(2, '0')}`)
    expect(config.endIsoDay).toBe(`2026-${String(productConfig.eventCycle.typicalEnd.monthIndex + 1).padStart(2, '0')}-${String(productConfig.eventCycle.typicalEnd.day).padStart(2, '0')}`)
    expect(config.startIsoDay).toBe('2026-10-15')
    expect(config.endIsoDay).toBe('2026-10-25')
    expect(config.finaleIsoDay).toBe(config.endIsoDay)
    expect(config.specialIsoDays).toEqual(['2026-10-16', '2026-10-17', '2026-10-23', '2026-10-24'])
    expect(config.duringIsoDays).toEqual(['2026-10-15'])
  })

  it('every configured phase carries exactly three prompts', () => {
    const config = buglasanEventTimelineConfig(2026)
    for (const set of [config.before, config.during, config.special, config.finale, config.after]) expect(set).toHaveLength(3)
  })
})

describe('empty-state chip rendering', () => {
  it('ChatInterface renders exactly the three timeline chips as buttons', () => {
    const questions = getFestivalQuickQuestions(manilaNoonUtc('2026-10-16'))
    const sent: string[] = []
    const tree = ChatInterface({ messages: [], isLoading: false, messagesEndRef: { current: null }, quickQuestions: questions, onSend: value => sent.push(value) })
    const serialized = JSON.stringify(tree)
    for (const question of questions) expect(serialized).toContain(question)
    expect(questions).toHaveLength(3)
  })
})
