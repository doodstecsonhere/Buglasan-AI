import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  buildInclusiveDateArithmeticGuidance,
  getLexicalEvidenceTerms,
  mapValidatedClaimCitations,
  shouldUseZeroEvidenceFallback,
  type GroundingSourceRecord,
} from './grounding.ts'

const source: GroundingSourceRecord = {
  id: 'source-1', post_id: 'official-post-1', normalized_text: 'Pandanyag Festival - La Libertad', raw_text: null,
  platform: 'facebook', post_url: 'https://www.facebook.com/Buglasan/posts/official-post-1/',
  published_at: '2026-07-31T11:34:59+08:00', festival_year: 2026, is_current: true, status: 'active',
}

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
