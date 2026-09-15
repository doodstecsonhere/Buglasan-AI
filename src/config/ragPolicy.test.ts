import { describe, expect, it } from 'vitest'
import { configuredProduct } from '../../config/product-config.mjs'
import {
  assertProductRagParity,
  defineRagPolicy,
  genericRagPrinciples,
  ragPolicy,
} from '../../config/rag-policy.mjs'

const syntheticPolicy = () => ({
  identity: {
    assistantName: 'Harbor Guide',
    festivalName: 'Lantern Harbor Gathering',
    description: 'a multilingual guide for a synthetic gathering',
    productStatus: 'unofficial',
    knowledgeStewardship: 'operator-curated',
  },
  regional: { timeZone: 'Pacific/Auckland' },
  languages: {
    default: 'en',
    supported: [{ code: 'en', label: 'English' }, { code: 'mi', label: 'Māori' }],
  },
  years: { minimum: 2018, maximum: 2040, defaultBehavior: 'current-calendar-year' },
  verification: { authority: 'official-source', label: 'Harbor notices', url: 'https://example.org/harbor' },
  citations: {
    required: true,
    platform: 'web',
    host: 'example.org',
    pagePath: '/harbor',
    postPathPrefix: '/harbor/posts/',
  },
  chat: { conversationHistoryLimit: 4 },
})

const clone = <T>(value: T): T => structuredClone(value)

describe('Phase 3 RAG policy', () => {
  it('P3-T1 preserves the materially equivalent assistant and festival identity', () => {
    expect(ragPolicy.identity).toMatchObject({ assistantName: 'Buglasan AI', festivalName: 'Buglasan Festival' })
  })

  it('P3-T2 preserves the Manila timezone', () => expect(ragPolicy.regional.timeZone).toBe('Asia/Manila'))

  it('P3-T3 preserves deterministic supported languages', () => {
    expect(ragPolicy.languages).toEqual({
      default: 'en', supported: [
        { code: 'en', label: 'English' },
        { code: 'ceb', label: 'Cebuano/Bisaya' },
        { code: 'fil', label: 'Filipino/Tagalog' },
      ],
    })
  })

  it('P3-T4 preserves exact year bounds and calendar-year defaulting', () => {
    expect(ragPolicy.years).toEqual({ minimum: 2020, maximum: 2030, defaultBehavior: 'current-calendar-year' })
  })

  it('P3-T5 preserves the credential-free verification destination', () => {
    expect(ragPolicy.verification.url).toBe('https://www.facebook.com/Buglasan')
    expect(new URL(ragPolicy.verification.url).username).toBe('')
  })

  it('P3-T6 explicitly records unofficial product status', () => expect(ragPolicy.identity.productStatus).toBe('unofficial'))
  it('P3-T7 keeps operator curation distinct from official authority', () => {
    expect(ragPolicy.identity.knowledgeStewardship).toBe('operator-curated')
    expect(ragPolicy.verification.authority).toBe('official-source')
    expect(genericRagPrinciples.provenance.operatorCuratedIsNotOfficial).toBe(true)
  })
  it('P3-T8 states that official evidence does not imply official product affiliation', () => {
    expect(genericRagPrinciples.provenance.officialSourceDoesNotImplyOfficialProduct).toBe(true)
  })
  it('P3-T9 preserves UNKNOWN != NO', () => expect(genericRagPrinciples.evidence.unknownIsNotNo).toBe(true))
  it('P3-T10 preserves zero-evidence fallback policy', () => expect(genericRagPrinciples.evidence.zeroEvidenceRequiresFallback).toBe(true))
  it('P3-T11 preserves exact-year isolation', () => expect(genericRagPrinciples.evidence.exactYearIsolation).toBe(true))
  it('P3-T12 preserves supersession awareness', () => expect(genericRagPrinciples.evidence.supersessionAware).toBe(true))
  it('P3-T13 preserves required citations', () => expect(genericRagPrinciples.evidence.citationsRequired).toBe(true))

  it('P3-T14 deeply freezes deployment values and generic principles', () => {
    expect(Object.isFrozen(ragPolicy)).toBe(true)
    expect(Object.isFrozen(ragPolicy.languages.supported)).toBe(true)
    expect(Object.isFrozen(genericRagPrinciples.evidence)).toBe(true)
  })

  it('P3-T15 rejects missing and unknown schema keys', () => {
    const missing = clone(syntheticPolicy()) as Record<string, unknown>
    delete missing.chat
    expect(() => defineRagPolicy(missing)).toThrow(/chat.*required/)
    expect(() => defineRagPolicy({ ...syntheticPolicy(), surprise: true })).toThrow(/surprise.*not supported/)
  })

  it('P3-T16 rejects credentials, query strings, and fixture markers', () => {
    const queried = syntheticPolicy(); queried.verification.url = 'https://example.org/harbor?token=public'
    expect(() => defineRagPolicy(queried)).toThrow(/credential-free HTTPS/)
    const marked = syntheticPolicy(); marked.identity.description = 'demo fixture guide'
    expect(() => defineRagPolicy(marked)).toThrow(/fixture markers/)
  })

  it('P3-T17 rejects invalid year ranges and timezone values', () => {
    const years = syntheticPolicy(); years.years.minimum = 2041
    expect(() => defineRagPolicy(years)).toThrow(/must not exceed/)
    const zone = syntheticPolicy(); zone.regional.timeZone = 'Ocean/Imaginary'
    expect(() => defineRagPolicy(zone)).toThrow(/IANA time zone/)
  })

  it('P3-T18 enforces deterministic browser/server parity', () => {
    expect(assertProductRagParity(configuredProduct, ragPolicy)).toBe(true)
    const drifted = { ...clone(ragPolicy), regional: { timeZone: 'UTC' } }
    expect(() => assertProductRagParity(configuredProduct, drifted)).toThrow(/parity check failed/)
  })

  it('P3-T19 proves the declaration is domain-neutral with a synthetic non-Buglasan policy', () => {
    const policy = defineRagPolicy(syntheticPolicy())
    expect(policy.identity.assistantName).toBe('Harbor Guide')
    expect(JSON.stringify(policy)).not.toContain('Buglasan')
  })

  it('P3-T20 keeps the synthetic fixture test-only and outside production selection', () => {
    expect(ragPolicy.identity.assistantName).toBe('Buglasan AI')
    expect(JSON.stringify(ragPolicy)).not.toContain('Harbor Guide')
  })
})
