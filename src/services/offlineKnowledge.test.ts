import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { answerOffline, saveVerifiedKnowledge } from './offlineKnowledge'
import type { ChatResponse } from './chatService'

const response: ChatResponse = {
  message: { id: 'message', role: 'assistant', content: 'Official', timestamp: '2026-09-01T00:00:00.000Z', festivalYear: 2026, sources: [{ id: 'source', title: 'Official announcement', platform: 'facebook', postUrl: 'https://www.facebook.com/Buglasan/posts/1/', publishedAt: new Date('2026-09-01T00:00:00.000Z'), festivalYear: 2026, status: 'active' }] },
  retrievedSources: [], retrievedEvents: [{ id: 'event', eventName: 'Opening Ceremony', aliases: [], description: 'Opening', category: 'ceremony', startDatetime: new Date('2026-09-13T10:00:00.000Z'), endDatetime: new Date('2026-09-13T12:00:00.000Z'), venue: 'Capitol', organizer: 'Province', status: 'confirmed', festivalYear: 2026, createdAt: new Date(), updatedAt: new Date() }], yearResolved: 2026, language: 'en',
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
})
