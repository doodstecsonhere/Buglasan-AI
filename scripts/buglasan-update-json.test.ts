import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

// Regression: the --json preview payload once emitted `needs_review` and
// `needs_content_review` twice in one object literal (counts first, detail
// arrays second), so JSON.stringify silently dropped both counts. The preview
// contract keeps one count key per lane and names the detail lanes
// `*_details` exactly like the text report's two distinct concepts.
const source = readFileSync(new URL('./buglasan-update.ts', import.meta.url), 'utf8')

function extractPreviewPayloadLiteral(): string {
  const marker = source.indexOf("status: 'preview_only'")
  expect(marker, 'preview_only JSON payload exists in buglasan-update.ts').toBeGreaterThan(-1)
  const open = source.lastIndexOf('{', marker)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  throw new Error('unbalanced object literal for the preview_only payload')
}

function evaluatePreviewPayload(): Record<string, unknown> {
  const bundle = { bundleId: '7', identity: { postId: 'post-7', canonicalUrl: 'https://example.invalid/post-7', reason: 'identity gap' }, classificationReason: 'video without caption', media: [], rawUrl: 'https://example.invalid/raw' }
  const count = () => 2
  const stubs = {
    comparison: {
      totalBundles: count(),
      unchanged: [bundle, bundle],
      newSources: [bundle, bundle],
      changedSources: [bundle, bundle],
      needsIdentityReview: [bundle, bundle],
      needsReview: [bundle, bundle],
      incomplete: [bundle, bundle],
      invalid: [bundle, bundle],
    },
    reanalysis: [bundle, bundle],
  }
  const text = `({${extractPreviewPayloadLiteral()}})`
  return runInNewContext(text, stubs) as Record<string, unknown>
}

function topLevelKeys(literal: string): string[] {
  // Nested map objects re-declare `bundle_id` / `post_id` / `canonical_url` /
  // `raw_url` / `reason`, so top-level lanes are identified by the documented
  // lane vocabulary instead of indentation (which CRLF-safe parsing must not
  // depend on either way).
  const candidates = [...literal.matchAll(/^\s+([a-z][a-z_]+):/gm)].map((match) => match[1])
  const lanes = new Set(['status', 'bundles_scanned', 'unchanged', 'new', 'changed', 'needs_identity_review', 'needs_content_review', 'incomplete', 'invalid', 'proposed_reanalysis', 'proposed_intake', 'needs_identity_review_details', 'needs_content_review_details'])
  return candidates.filter((key) => lanes.has(key))
}

describe('buglasan-update --json preview payload', () => {
  it('declares every top-level key exactly once in the source literal', () => {
    const keys = topLevelKeys(extractPreviewPayloadLiteral())
    expect(keys).toEqual(expect.arrayContaining(['status', 'bundles_scanned', 'needs_identity_review', 'needs_content_review', 'needs_identity_review_details', 'needs_content_review_details']))
    expect(new Set(keys).size, `duplicate literal keys: ${keys.join(', ')}`).toBe(keys.length)
  })

  it('emits both count lanes and both detail lanes as distinct JSON fields', () => {
    const payload = evaluatePreviewPayload()
    const serialized = JSON.stringify(payload)
    const parsed = JSON.parse(serialized) as Record<string, unknown>
    expect(parsed.status).toBe('preview_only')
    expect(parsed.needs_identity_review).toBe(2)
    expect(parsed.needs_content_review).toBe(2)
    expect(parsed.needs_review).toBeUndefined()
    expect(Array.isArray(parsed.needs_identity_review_details)).toBe(true)
    expect((parsed.needs_identity_review_details as unknown[]).length).toBe(2)
    expect(Array.isArray(parsed.needs_content_review_details)).toBe(true)
    expect((parsed.needs_content_review_details as unknown[]).length).toBe(2)
    // Counts survive serialization: the overwrite bug dropped them entirely.
    expect(serialized).toContain('"needs_content_review":2')
    expect(serialized).toContain('"needs_identity_review":2')
  })
})
