const assertEquals = (actual: unknown, expected: unknown): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
import {
  buildInclusiveDateArithmeticGuidance,
  buildNoVerifiedEventListingFallback,
  buildNoVerifiedAnnouncementFallback,
  buildRecoverableFailureFallback,
  buildZeroEvidenceFallback,
  buildGroundedGenerationFallback,
  buildTemporaryServiceError,
  getDeterministicHarmlessResponse,
  getLightweightConversationResponse,
  getOutOfScopeResponse,
  getLexicalEvidenceTerms,
  isFutureDiscoveryQuery,
  isFestivalInformationQuery,
  isTemporalOnlyQuery,
  isEventWindowQuery,
  isAnnouncementQuery,
  mapValidatedClaimCitations,
  isExactOfficialFacebookPostUrl,
  shouldUseZeroEvidenceFallback,
  isValidCitationSource,
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

Deno.test('accepts only exact canonical official Facebook posts and authorized reel URLs', () => {
  assertEquals(isExactOfficialFacebookPostUrl('https://www.facebook.com/Buglasan/posts/123456789/', '123456789'), true)
  assertEquals(isExactOfficialFacebookPostUrl('https://www.facebook.com/Buglasan/posts/example/123456789/', '123456789'), true)
  assertEquals(isExactOfficialFacebookPostUrl('https://www.facebook.com/reel/123456789/', '123456789'), true)
  assertEquals(isExactOfficialFacebookPostUrl('https://www.facebook.com/reel/123456789/', 'reel-123456789'), true)
  assertEquals(isExactOfficialFacebookPostUrl('https://www.facebook.com/reel/123456789/', 'reel-987654321'), false)
  assertEquals(isExactOfficialFacebookPostUrl('https://www.facebook.com/Buglasan/posts/123456789/?redirect=bad', '123456789'), false)
  assertEquals(isExactOfficialFacebookPostUrl('https://www.facebook.com/Other/posts/123456789/', '123456789'), false)
  assertEquals(isExactOfficialFacebookPostUrl('https://www.facebook.com/OtherPage/reel/123456789/', '123456789'), false)
  assertEquals(isExactOfficialFacebookPostUrl('https://www.facebook.com/reel/123456789/?redirect=bad', '123456789'), false)
})

Deno.test('grounding: citation mapping keeps only valid, retrieved, linkable sources', () => {
  const supportedReel = { ...source, id: 'reel-source', post_id: '987654321', post_url: 'https://www.facebook.com/reel/987654321/' }
  const unsupported = { ...source, id: 'bad-source', post_url: 'https://www.facebook.com/OtherPage/videos/987654321/' }
  const mapped = mapValidatedClaimCitations('[source 1] [Source 2] [Source 3] _(src: unknown)_', [source, supportedReel, unsupported])
  assertEquals(mapped.sourceIds, ['source-1', 'reel-source'])
  assertEquals(mapped.claims, [
    { claimIndex: 0, sourceId: 'source-1', marker: '[source 1]' },
    { claimIndex: 1, sourceId: 'reel-source', marker: '[Source 2]' },
  ])
})

Deno.test('grounding: canonical reels and independent historical Buglasan posts retain provenance', () => {
  const canonicalReel = {
    ...source,
    id: 'reel-2026',
    post_id: 'reel-987654321',
    post_url: 'https://www.facebook.com/reel/987654321/',
  }
  const historicalPost = {
    ...source,
    id: 'post-2025',
    post_id: '202512345',
    post_url: 'https://www.facebook.com/Buglasan/posts/202512345/',
    festival_year: 2025,
    is_current: false,
    status: 'archived',
  }

  assertEquals(isValidCitationSource(canonicalReel), true)
  assertEquals(isValidCitationSource(historicalPost), true)
  assertEquals(
    mapValidatedClaimCitations('[Source 1] [Source 2]', [canonicalReel, historicalPost]),
    {
      sourceIds: ['reel-2026', 'post-2025'],
      claims: [
        { claimIndex: 0, sourceId: 'reel-2026', marker: '[Source 1]' },
        { claimIndex: 1, sourceId: 'post-2025', marker: '[Source 2]' },
      ],
    },
  )
})

Deno.test('grounding: fabricated markers and unsupported evidence never create structured citations', () => {
  const unsupported = {
    ...source,
    id: 'unsupported-video',
    post_id: '111222333',
    post_url: 'https://www.facebook.com/OtherPage/videos/111222333/',
  }
  const mapped = mapValidatedClaimCitations(
    'Fabricated claim [Source 3] _(src: not-retrieved)_ [Source 2]',
    [source, unsupported],
  )
  assertEquals(mapped.sourceIds, [])
  assertEquals(mapped.claims, [])
})

Deno.test('grounding: UNKNOWN evidence and FY2026 evidence remain isolated', () => {
  const unknownYear = { ...source, id: 'unknown-year', festival_year: null }
  const fy2026 = { ...source, id: 'fy2026' }
  assertEquals(isValidCitationSource(unknownYear), false)
  assertEquals(
    mapValidatedClaimCitations('[Source 1] [Source 2]', [unknownYear, fy2026]),
    {
      sourceIds: ['fy2026'],
      claims: [{ claimIndex: 0, sourceId: 'fy2026', marker: '[Source 2]' }],
    },
  )
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

Deno.test('grounding: arithmetic parser is not a public scope bypass', () => {
  assertEquals(getDeterministicHarmlessResponse('2 + 2'), '4')
  assertEquals(getDeterministicHarmlessResponse('whats 2 plus 2'), '4')
  assertEquals(getDeterministicHarmlessResponse('2 / 0'), 'I cannot divide by zero.')
})

Deno.test('grounding: unrelated math, knowledge, and code prompts are scope-guarded before retrieval', () => {
  for (const query of ['23 plus 76', 'square root 52', 'What is the capital of France?', 'How do I write a JavaScript loop?']) {
    assertEquals(isFestivalInformationQuery(query), false)
    assertEquals(getOutOfScopeResponse(query, 'en')?.includes('Buglasan AI'), true)
  }
})

Deno.test('grounding: standalone tomorrow is temporal-only and broad discovery is recognized', () => {
  assertEquals(isTemporalOnlyQuery('What is happening tomorrow?'), true)
  assertEquals(isFutureDiscoveryQuery('Anything interesting coming up?'), true)
})

Deno.test('grounding: production acceptance temporal and latest prompts remain grounded and use request-specific 2026 fallbacks', () => {
  for (const query of ['What are the Buglasan events for today?', 'What are the Buglasan events tomorrow?', "What's the latest update?"]) {
    assertEquals(isFestivalInformationQuery(query), true)
  }
  assertEquals(buildNoVerifiedEventListingFallback(2026, 'en').includes('No verified Buglasan Festival 2026 event listing'), true)
  const latestFallback = buildZeroEvidenceFallback(2026, 'en')
  assertEquals(latestFallback.includes('No verified current official Buglasan Festival 2026 information matches this request'), true)
  assertEquals(latestFallback.includes('https://www.facebook.com/Buglasan'), true)
  for (const query of ["What's the latest update?", 'latest announcement', 'current announcement']) {
    assertEquals(isAnnouncementQuery(query), true)
    assertEquals(isEventWindowQuery(query), false)
  }
  assertEquals(buildNoVerifiedAnnouncementFallback(2026, 'en').includes('announcement is available'), true)
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

Deno.test('grounding: isolated failure simulation keeps evidence failures grounded and zero-evidence failures visible', () => {
  const withEvidence = { sources: [source], chunks: [], events: [] }
  const withoutEvidence = { sources: [], chunks: [], events: [] }
  // This pure dependency seam safely covers retrieval and malformed/empty
  // provider content without an unauthenticated production failure switch.
  assertEquals(buildRecoverableFailureFallback(withEvidence, 'en'), buildGroundedGenerationFallback('en'))
  assertEquals(buildRecoverableFailureFallback(withoutEvidence, 'en'), buildTemporaryServiceError('en'))
})
