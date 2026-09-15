import { describe, expect, it } from 'vitest'
import { assertValidProductConfig, defineProductConfig, productConfig, type ProductConfig } from './productConfig'

const cloneConfig = (): ProductConfig => structuredClone(productConfig)
const mutate = (config: ProductConfig) => config as unknown as Record<string, any>

describe('productConfig Phase 1 boundary', () => {
  it('P1 pins production identity, aliases, vocabulary, and description', () => {
    expect(productConfig.identity).toEqual({
      assistantName: 'Buglasan AI', festivalName: 'Buglasan Festival', festivalShortName: 'Buglasan',
      description: 'A multilingual, year-aware AI companion for the Buglasan Festival of Negros Oriental',
      aliases: ['Buglasan', 'Buglasan Festival'], vocabulary: ['festival', 'schedule', 'event', 'announcement', 'registration'],
    })
  })

  it('P2 defines deterministic languages, default, labels, and browser prefixes', () => {
    expect(productConfig.languages).toEqual({ default: 'en', supported: [
      { code: 'en', displayLabel: 'English', browserPrefixes: [] },
      { code: 'ceb', displayLabel: 'Cebuano/Bisaya', browserPrefixes: ['ceb'] },
      { code: 'fil', displayLabel: 'Filipino/Tagalog', browserPrefixes: ['fil', 'tl'] },
    ] })
  })

  it('P3 pins current trust, authority, source, and non-affiliation hooks', () => {
    expect(productConfig.officialSource).toEqual({ id: 'buglasan-facebook', authorityLabel: 'Official', pageLabel: 'Buglasan Festival Facebook Page', url: 'https://www.facebook.com/Buglasan' })
    expect(productConfig.trust.nonAffiliationNotice).toBe('Data sourced from official channels. Not affiliated with the Provincial Government of Negros Oriental.')
  })

  it('P4 preserves timezone, locale, and calendar-year event-cycle behavior', () => {
    expect(productConfig.regional).toEqual({ timeZone: 'Asia/Manila', clockConversionLocale: 'en-US', displayLocale: 'en-PH' })
    expect(productConfig.eventCycle).toEqual({ yearBoundary: 'calendar-year', queryYearMin: 2020, queryYearMax: 2030, typicalStart: { monthIndex: 9, day: 15 }, typicalEnd: { monthIndex: 9, day: 25 } })
  })

  it('P5 preserves app branding references and behavior limits', () => {
    expect(productConfig.branding).toEqual({ wordmark: 'BUGLASAN AI', appIconPath: '/icons/icon-192.png' })
    expect(productConfig.chatPolicy).toEqual({ conversationHistoryLimit: 6, composerMaxLength: 2000, threadTitleMaxLength: 48, offlineEventLimit: 6 })
  })

  it('P6 preserves the stable storage namespace and existing identifiers', () => {
    expect(productConfig.persistence).toEqual({ namespace: 'buglasan-ai', chatThreadsStorageKey: 'buglasan-ai.chat-threads.v1', installDismissedStorageKey: 'buglasan-install-dismissed', offlineKnowledge: { databaseName: 'buglasan-ai-offline-knowledge', storeName: 'verified-snapshots', databaseVersion: 1 } })
  })

  it('P7 deeply freezes the exported configuration', () => {
    expect(Object.isFrozen(productConfig)).toBe(true)
    expect(Object.isFrozen(productConfig.identity.aliases)).toBe(true)
    expect(Object.isFrozen(productConfig.languages.supported[0])).toBe(true)
    expect(Object.isFrozen(productConfig.persistence.offlineKnowledge)).toBe(true)

    const hiddenValue = { nested: { value: true } }
    const symbolValue = { nested: { value: true } }
    const configurable = cloneConfig()
    Object.defineProperty(configurable.identity.aliases, 'hidden', { value: hiddenValue, enumerable: false })
    Object.defineProperty(configurable.identity.aliases, Symbol('metadata'), { value: symbolValue, enumerable: false })
    defineProductConfig(configurable)
    expect(Object.isFrozen(hiddenValue)).toBe(true)
    expect(Object.isFrozen(hiddenValue.nested)).toBe(true)
    expect(Object.isFrozen(symbolValue)).toBe(true)
    expect(Object.isFrozen(symbolValue.nested)).toBe(true)
  })

  it('P8 fails closed for missing and unknown schema fields', () => {
    const missing = cloneConfig(); delete mutate(missing).identity
    expect(() => assertValidProductConfig(missing)).toThrow('identity')
    const extra = cloneConfig(); mutate(extra).unexpected = true
    expect(() => assertValidProductConfig(extra)).toThrow('productConfig.unexpected')
    const hidden = cloneConfig(); Object.defineProperty(hidden.identity, 'unexpected', { value: true, enumerable: false })
    expect(() => assertValidProductConfig(hidden)).toThrow('identity.unexpected')
    const symbol = cloneConfig(); Object.defineProperty(symbol.identity, Symbol('unexpected'), { value: true })
    expect(() => assertValidProductConfig(symbol)).toThrow('identity.Symbol(unexpected)')
  })

  it('P9 genuinely validates IANA timezone and locale support', () => {
    const badZone = cloneConfig(); mutate(badZone).regional.timeZone = 'Mars/Olympus'
    expect(() => assertValidProductConfig(badZone)).toThrow('regional.timeZone')
    const badLocale = cloneConfig(); mutate(badLocale).regional.displayLocale = 'not_a_locale'
    expect(() => assertValidProductConfig(badLocale)).toThrow('regional.displayLocale')
  })

  it('P10 validates safe IDs, namespace ownership, paths, and URLs', () => {
    const badId = cloneConfig(); mutate(badId).officialSource.id = '../source'
    expect(() => assertValidProductConfig(badId)).toThrow('officialSource.id')
    const badKey = cloneConfig(); mutate(badKey).persistence.chatThreadsStorageKey = 'other.chat.v1'
    expect(() => assertValidProductConfig(badKey)).toThrow('persistence')
    const badUrl = cloneConfig(); mutate(badUrl).officialSource.url = 'https://user:pass@example.com'
    expect(() => assertValidProductConfig(badUrl)).toThrow('officialSource.url')
    const queryUrl = cloneConfig(); mutate(queryUrl).officialSource.url = 'https://example.com/official?access_token=public'
    expect(() => assertValidProductConfig(queryUrl)).toThrow('must not contain a query string or fragment')
    const fragmentUrl = cloneConfig(); mutate(fragmentUrl).officialSource.url = 'https://example.com/official#updates'
    expect(() => assertValidProductConfig(fragmentUrl)).toThrow('must not contain a query string or fragment')
  })

  it('P11 validates event ranges, language uniqueness, and positive limits', () => {
    const badRange = cloneConfig(); mutate(badRange).eventCycle.typicalStart.monthIndex = 10
    expect(() => assertValidProductConfig(badRange)).toThrow('eventCycle.typicalStart')
    const duplicateLanguage = cloneConfig(); mutate(duplicateLanguage).languages.supported[1].code = 'en'
    expect(() => assertValidProductConfig(duplicateLanguage)).toThrow('languages.supported')
    const duplicatePrefix = cloneConfig(); mutate(duplicatePrefix).languages.supported[2].browserPrefixes = ['fil', 'ceb']
    expect(() => assertValidProductConfig(duplicatePrefix)).toThrow('languages.supported[2].browserPrefixes[1]')
    const badLimit = cloneConfig(); mutate(badLimit).chatPolicy.composerMaxLength = 0
    expect(() => assertValidProductConfig(badLimit)).toThrow('chatPolicy.composerMaxLength')
  })

  it('P12 rejects demo markers and obvious credential/token indicators, then freezes validated definitions', () => {
    const demo = cloneConfig(); mutate(demo).identity.description = 'Demo fixture fallback'
    expect(() => defineProductConfig(demo)).toThrow('demo markers or obvious credential/token indicators')
    const bearer = cloneConfig(); mutate(bearer).identity.description = 'Bearer abcdefghijklmnop'
    expect(() => defineProductConfig(bearer)).toThrow('obvious credential/token indicators')
    const privateKey = cloneConfig(); mutate(privateKey).identity.description = 'private-key material'
    expect(() => defineProductConfig(privateKey)).toThrow('obvious credential/token indicators')
    const defined = defineProductConfig(cloneConfig())
    expect(Object.isFrozen(defined)).toBe(true)
  })
})
