import { describe, expect, it } from 'vitest'
import { buglasanFreshnessConfig, defineDeploymentFreshnessConfig } from '../config/freshnessConfig'
import {
  classifyAnswerFreshnessWarning,
  createCorpusHealth,
  createFreshnessMetadata,
  evaluateFreshness,
  evaluateTimestampFreshness,
  formatFreshnessDate,
  validateFreshnessPolicy,
} from './freshness'

const now = new Date('2026-09-15T12:00:00.000Z')
const policy = validateFreshnessPolicy({ thresholds: { agingAfterHours: 24, staleAfterHours: 72 }, timeZone: 'Asia/Manila', dateTimeLocale: 'en-PH' })

describe('Phase 4 freshness engine', () => {
  it('P4-T1..T4 classifies fresh, aging, stale, and unknown deterministically', () => {
    expect(evaluateTimestampFreshness('sourcePublishedAt', '2026-09-15T11:00:00Z', policy, now).state).toBe('FRESH')
    expect(evaluateTimestampFreshness('sourcePublishedAt', '2026-09-14T11:00:00Z', policy, now).state).toBe('AGING')
    expect(evaluateTimestampFreshness('sourcePublishedAt', '2026-09-12T11:00:00Z', policy, now).state).toBe('STALE')
    expect(evaluateTimestampFreshness('sourcePublishedAt', 'not-a-date', policy, now).state).toBe('UNKNOWN')
    expect(evaluateTimestampFreshness('sourcePublishedAt', '2026-09-15T13:00:00Z', policy, now).state).toBe('UNKNOWN')
  })

  it('P4-T5..T7 keeps published, collected, and knowledge-base timestamps distinct', () => {
    const result = evaluateFreshness({ sourcePublishedAt: '2026-09-15T11:00:00Z', sourceCollectedAt: '2026-09-14T11:00:00Z', knowledgeBaseUpdatedAt: '2026-09-12T11:00:00Z' }, policy, now)
    expect(result.timestamps.sourcePublishedAt.state).toBe('FRESH')
    expect(result.timestamps.sourceCollectedAt.state).toBe('AGING')
    expect(result.timestamps.knowledgeBaseUpdatedAt.state).toBe('STALE')
    expect(result.overallState).toBe('STALE')
  })

  it('P4-T8..T10 validates thresholds and timezone-aware formatting', () => {
    expect(() => validateFreshnessPolicy({ thresholds: { agingAfterHours: 72, staleAfterHours: 24 }, timeZone: 'Asia/Manila', dateTimeLocale: 'en-PH' })).toThrow()
    expect(() => validateFreshnessPolicy({ thresholds: { agingAfterHours: 0, staleAfterHours: 24 }, timeZone: 'Asia/Manila', dateTimeLocale: 'en-PH' })).toThrow()
    expect(formatFreshnessDate('2026-09-15T12:00:00Z', policy)).toContain('20:00')
  })

  it('P4-T11..T13 bounds corpus health and exposes humility copy', () => {
    expect(createCorpusHealth('HEALTHY', 'Corpus is current.')).toEqual({ state: 'HEALTHY', humilityFlag: false, copy: 'Corpus is current.' })
    expect(createCorpusHealth('DEGRADED', 'Some current sources may be missing.').humilityFlag).toBe(true)
    expect(() => createCorpusHealth('NOPE' as never, 'invalid')).toThrow()
  })

  it('P4-T14..T16 classifies time-sensitive answer warnings', () => {
    const freshness = evaluateFreshness({ sourcePublishedAt: '2026-09-12T11:00:00Z', sourceCollectedAt: '2026-09-15T11:00:00Z', knowledgeBaseUpdatedAt: '2026-09-12T11:00:00Z' }, policy, now)
    expect(classifyAnswerFreshnessWarning({ questionIsTimeSensitive: true, freshness, corpusHealth: createCorpusHealth('HEALTHY', 'Current.') })).toBe('STALE_SOURCE')
    expect(classifyAnswerFreshnessWarning({ questionIsTimeSensitive: false, freshness, corpusHealth: createCorpusHealth('HEALTHY', 'Current.') })).toBe('NONE')
    expect(classifyAnswerFreshnessWarning({ questionIsTimeSensitive: true, freshness, corpusHealth: createCorpusHealth('UNAVAILABLE', 'Freshness cannot be confirmed.') })).toBe('STALE_CORPUS')
  })

  it('P4-T17..T19 adds bounded answer metadata without changing evidence inputs', () => {
    const metadata = createFreshnessMetadata(
      'What is the latest schedule?',
      { sourcePublishedAt: '2026-09-15T11:00:00Z', sourceCollectedAt: null, knowledgeBaseUpdatedAt: '2026-09-15T10:00:00Z' },
      policy,
      now,
      createCorpusHealth('HEALTHY', 'Verified response evidence is available.'),
    )
    expect(metadata.warning).toBe('UNKNOWN_FRESHNESS')
    expect(metadata.evaluation.timestamps.sourcePublishedAt.timestamp).toBe('2026-09-15T11:00:00Z')
    expect(metadata.corpusHealth.humilityFlag).toBe(false)
  })

  it('P4-T22..T24 keeps synthetic deployment freshness independent from Buglasan identity', () => {
    const synthetic = defineDeploymentFreshnessConfig({ deploymentId: 'harbor-days', identity: { assistantName: 'Harbor Days Guide', eventName: 'Harbor Days' }, freshness: { thresholds: { agingAfterHours: 6, staleAfterHours: 18 }, timeZone: 'America/New_York', dateTimeLocale: 'en-US' } })
    expect(JSON.stringify(synthetic)).not.toContain('Buglasan')
    expect(JSON.stringify(synthetic)).not.toContain('buglasan')
  })

  it('P4-T24 validates public Buglasan policy and isolates synthetic deployment identity', () => {
    expect(buglasanFreshnessConfig.identity).toEqual({ assistantName: 'Buglasan AI', eventName: 'Buglasan Festival' })
    const synthetic = defineDeploymentFreshnessConfig({ deploymentId: 'harbor-days', identity: { assistantName: 'Harbor Days Guide', eventName: 'Harbor Days' }, freshness: { thresholds: { agingAfterHours: 6, staleAfterHours: 18 }, timeZone: 'America/New_York', dateTimeLocale: 'en-US' } })
    expect(synthetic.freshness.thresholds).toEqual({ agingAfterHours: 6, staleAfterHours: 18 })
    expect(synthetic.freshness.timeZone).toBe('America/New_York')
    expect(synthetic.identity).not.toEqual(buglasanFreshnessConfig.identity)
    expect(Object.isFrozen(synthetic)).toBe(true)
  })
})
