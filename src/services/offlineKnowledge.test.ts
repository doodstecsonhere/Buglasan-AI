import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { answerOffline, saveVerifiedKnowledge } from './offlineKnowledge'
import type { ChatResponse } from './chatService'
import { createCorpusHealth, createFreshnessMetadata, validateFreshnessPolicy } from '../utils/freshness'

const response: ChatResponse = {
  message: { id: 'message', role: 'assistant', content: 'Official', timestamp: '2026-09-01T00:00:00.000Z', festivalYear: 2026, sources: [{ id: 'source', title: 'Official announcement', platform: 'facebook', postUrl: 'https://www.facebook.com/Buglasan/posts/1/', publishedAt: new Date('2026-09-01T00:00:00.000Z'), festivalYear: 2026, status: 'active' }] },
  retrievedSources: [], retrievedEvents: [{ id: 'event', eventName: 'Opening Ceremony', aliases: [], description: 'Opening', category: 'ceremony', startDatetime: new Date('2026-09-13T10:00:00.000Z'), endDatetime: new Date('2026-09-13T12:00:00.000Z'), venue: 'Capitol', organizer: 'Province', status: 'confirmed', festivalYear: 2026, createdAt: new Date(), updatedAt: new Date() }], yearResolved: 2026, language: 'en',
}

const responseWithFreshness: ChatResponse = {
  ...response,
  freshness: createFreshnessMetadata(
    'latest update',
    { sourcePublishedAt: '2026-09-01T00:00:00.000Z', sourceCollectedAt: '2026-09-01T01:00:00.000Z', knowledgeBaseUpdatedAt: '2026-09-01T02:00:00.000Z' },
    validateFreshnessPolicy({ thresholds: { agingAfterHours: 24, staleAfterHours: 72 }, timeZone: 'Asia/Manila', dateTimeLocale: 'en-PH' }),
    new Date('2026-09-01T03:00:00.000Z'),
    createCorpusHealth('HEALTHY', 'Verified response evidence is available.'),
  ),
}

describe('offline verified knowledge', () => {
  beforeEach(() => {
    indexedDB.deleteDatabase('buglasan-ai-offline-knowledge')
  })

  it('answers a cached latest update with a source URL and localized freshness', async () => {
    await saveVerifiedKnowledge(response)
    const result = await answerOffline({ message: "What's the latest update?", language: 'en' }, 2026)
    expect(result.message.content).toContain('https://www.facebook.com/Buglasan/posts/1/')
    expect(result.message.content).toContain('Offline cache saved')
  })

  it('distinguishes zero cache and unavailable cached queries', async () => {
    expect((await answerOffline({ message: 'today', language: 'en' }, 2026)).message.content).toContain('no verified Buglasan information is cached')
    await saveVerifiedKnowledge(response)
    expect((await answerOffline({ message: 'venue for imaginary item', language: 'ceb' }, 2026)).message.content).toContain('Dili matubag')
  })

  it('isolates snapshots by festival year', async () => {
    await saveVerifiedKnowledge(response)
    expect((await answerOffline({ message: "What's the latest update?", language: 'en' }, 2027)).message.content).toContain('no verified Buglasan information is cached')
    expect((await answerOffline({ message: "What's the latest update?", language: 'en' }, 2026)).message.content).toContain('https://www.facebook.com/Buglasan/posts/1/')
  })

  it('P4-T20..T21 preserves verified freshness metadata through offline snapshot round-trip', async () => {
    await saveVerifiedKnowledge(responseWithFreshness)
    const result = await answerOffline({ message: "What's the latest update?", language: 'en' }, 2026)
    expect(result.freshness).toEqual(responseWithFreshness.freshness)
    expect(result.freshness?.evaluation.timestamps.knowledgeBaseUpdatedAt.timestamp).toBe('2026-09-01T02:00:00.000Z')
    expect(result.message.content).toContain('newer information may exist online')
  })
})
