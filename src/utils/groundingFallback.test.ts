import { describe, expect, it } from 'vitest'
import {
  OFFICIAL_BUGLASAN_FACEBOOK_URL,
  buildZeroEvidenceFallback,
  isGeneralConversation,
  shouldUseZeroEvidenceFallback,
  type SupportedLanguage,
} from '../../supabase/functions/chat/grounding'

const emptyEvidence = { sources: [], events: [], chunks: [] }

describe('zero-evidence grounding fallback', () => {
  it.each([
    ['en', 'No current official information was found'],
    ['ceb', 'Walay nakaplagang kasamtangang opisyal nga impormasyon'],
    ['fil', 'Walang nakitang kasalukuyang opisyal na impormasyon'],
  ] satisfies Array<[SupportedLanguage, string]>)('returns deterministic %s guidance with the resolved year', (language, opening) => {
    const response = buildZeroEvidenceFallback(2028, language)

    expect(response).toContain(opening)
    expect(response).toContain('2028')
    expect(response).toContain('Buglasan Festival Facebook Page')
    expect(response).toContain(OFFICIAL_BUGLASAN_FACEBOOK_URL)
  })

  it('does not leak historical, date, venue, event, organizer, tradition, or announcement-timing claims', () => {
    const responses = (['en', 'ceb', 'fil'] satisfies SupportedLanguage[]).map((language) =>
      buildZeroEvidenceFallback(2029, language),
    )

    for (const response of responses) {
      expect(response).not.toMatch(/\b(20(?:2[0-8]|3\d)|october|octubre|oktubre|15th|25th|venue|plaza|event|parade|organizer|provincial government|tradition|history|histor|mid-october|announce[ds]?\s+(?:in|on|by)|ipahibalo\s+(?:sa|pag)|iaanunsyo\s+(?:sa|ng))\b/i)
      expect(response).not.toMatch(/\[Source\s*\d*\]/i)
    }
  })

  it.each([
    'What is the Buglasan 2027 schedule?',
    'Where is the opening event?',
    'Kailan at saan ang festival?',
    'Kanus-a ang mga kalihokan sa Buglasan?',
    'Tell me about Buglasan history and traditions.',
  ])('requires the fallback for an empty factual retrieval packet: %s', (query) => {
    expect(shouldUseZeroEvidenceFallback(query, emptyEvidence)).toBe(true)
  })

  it('does not use the fallback when any usable official evidence exists', () => {
    expect(shouldUseZeroEvidenceFallback('What is the schedule?', {
      sources: [],
      events: [{ id: 'official-event' }],
      chunks: [],
    })).toBe(false)
  })

  it.each([
    'Hello!',
    'What can you do?',
    'Help me',
    'What languages do you speak?',
    'Can you speak Bisaya?',
    'Maayong buntag',
    'Paano ka makakatulong?',
  ])('preserves evidence-free general conversation: %s', (query) => {
    expect(isGeneralConversation(query)).toBe(true)
    expect(shouldUseZeroEvidenceFallback(query, emptyEvidence)).toBe(false)
  })

  it('does not mistake a factual festival request phrased conversationally for general conversation', () => {
    expect(shouldUseZeroEvidenceFallback('Hello, when is the Buglasan schedule?', emptyEvidence)).toBe(true)
  })

  it('produces no citations for the server fallback response contract', () => {
    const response = {
      content: buildZeroEvidenceFallback(2027, 'en'),
      sources: [],
    }

    expect(response.sources).toHaveLength(0)
    expect(response.content).not.toContain('[Source')
  })
})
