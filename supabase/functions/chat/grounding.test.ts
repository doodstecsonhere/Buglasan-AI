const assertEquals = (actual: unknown, expected: unknown): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
import {
  buildInclusiveDateArithmeticGuidance,
  buildNoVerifiedEventListingFallback,
  buildGroundedGenerationFallback,
  buildTemporaryServiceError,
  getDeterministicHarmlessResponse,
  getLightweightConversationResponse,
  getOutOfScopeResponse,
  getLexicalEvidenceTerms,
  isFutureDiscoveryQuery,
  isTemporalOnlyQuery,
  isEventWindowQuery,
  mapValidatedClaimCitations,
  isExactOfficialFacebookPostUrl,
  shouldUseZeroEvidenceFallback,
  type GroundingSourceRecord,
} from './grounding.ts'

declare const Deno: {
  test(name: string, fn: () => void): void
}

const source: GroundingSourceRecord = {
  id: 'source-1', post_id: '123456789', normalized_text: 'Pandanyag Festival - La Libertad', raw_text: null,
  platform: 'facebook', post_url: 'https://www.facebook.com/Buglasan/posts/123456789/',
  published_at: '2026-07-31T11:34:59+08:00', festival_year: 2026, is_current: true, status: 'active',
}

Deno.test('accepts only exact canonical official Facebook post URLs', () => {
  assertEquals(isExactOfficialFacebookPostUrl('https://www.facebook.com/Buglasan/posts/123456789/', '123456789'), true)
  assertEquals(isExactOfficialFacebookPostUrl('https://www.facebook.com/Buglasan/posts/example/123456789/', '123456789'), true)
  assertEquals(isExactOfficialFacebookPostUrl('https://www.facebook.com/Buglasan/posts/123456789/?redirect=bad', '123456789'), false)
  assertEquals(isExactOfficialFacebookPostUrl('https://www.facebook.com/Other/posts/123456789/', '123456789'), false)
})

Deno.test('grounding: citation mapping keeps only valid, retrieved, linkable sources', () => {
  const malformed = { ...source, id: 'bad-source', post_url: 'not-a-url' }
  const mapped = mapValidatedClaimCitations('[source 1] [Source 2] _(src: unknown)_', [source, malformed])
  assertEquals(mapped.sourceIds, ['source-1'])
  assertEquals(mapped.claims, [{ claimIndex: 0, sourceId: 'source-1', marker: '[source 1]' }])
})

Deno.test('grounding: unrelated canonical events do not defeat strict factual zero-evidence fallback', () => {
  assertEquals(shouldUseZeroEvidenceFallback('Where is the 2026 fireworks launch?', {
    sources: [], chunks: [], events: [{ event_name: 'Unrelated accepted event' }],
  }), true)
})

Deno.test('grounding: Filipino date arithmetic explicitly uses inclusive wording', () => {
  const guidance = buildInclusiveDateArithmeticGuidance('fil')
  assertEquals(guidance.includes('3 araw lahat'), true)
  assertEquals(guidance.includes('kasama ang Oktubre 10 at Oktubre 12'), true)
})

Deno.test('grounding: Pandanyag is retained as an exact-year lexical retrieval term', () => {
  assertEquals(getLexicalEvidenceTerms('Which LGU has the Pandanyag Festival in 2026?'), ['pandanyag'])
})

Deno.test('grounding: harmless arithmetic is deterministic and bypasses factual handling', () => {
  assertEquals(getDeterministicHarmlessResponse('2 + 2'), '4')
  assertEquals(getDeterministicHarmlessResponse('whats 2 plus 2'), '4')
  assertEquals(getDeterministicHarmlessResponse('2 / 0'), 'I cannot divide by zero.')
})

Deno.test('grounding: standalone tomorrow is temporal-only and broad discovery is recognized', () => {
  assertEquals(isTemporalOnlyQuery('What is happening tomorrow?'), true)
  assertEquals(isFutureDiscoveryQuery('Anything interesting coming up?'), true)
})

Deno.test('grounding: greetings and unrelated questions bypass retrieval with deterministic responses', () => {
  assertEquals(getLightweightConversationResponse('Hello!', 'en')?.includes('verified Buglasan Festival'), true)
  assertEquals(getLightweightConversationResponse('What can you do?', 'en')?.includes('schedules'), true)
  assertEquals(getOutOfScopeResponse('Who won the World Cup?', 'en')?.includes('Buglasan AI'), true)
})

Deno.test('grounding: temporal event windows require event evidence rather than generic sources', () => {
  assertEquals(isEventWindowQuery('What events are coming up for Buglasan 2026?'), true)
  assertEquals(buildNoVerifiedEventListingFallback(2026, 'en').includes('No verified Buglasan Festival 2026 event listing'), true)
  assertEquals(buildTemporaryServiceError('en').includes('temporarily unavailable'), true)
  assertEquals(isEventWindowQuery('When is Buglasan Festival 2026?'), true)
  assertEquals(buildGroundedGenerationFallback('en').includes('relevant official Buglasan information'), true)
})
