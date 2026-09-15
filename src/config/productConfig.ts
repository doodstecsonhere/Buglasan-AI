export type ProductLanguageCode = 'en' | 'ceb' | 'fil'

export interface ProductConfig {
  readonly identity: {
    readonly assistantName: string
    readonly festivalName: string
    readonly festivalShortName: string
    readonly description: string
    readonly aliases: readonly string[]
    readonly vocabulary: readonly string[]
  }
  readonly languages: {
    readonly default: ProductLanguageCode
    readonly supported: readonly {
      readonly code: ProductLanguageCode
      readonly displayLabel: string
      readonly browserPrefixes: readonly string[]
    }[]
  }
  readonly officialSource: {
    readonly id: string
    readonly authorityLabel: string
    readonly pageLabel: string
    readonly url: string
  }
  readonly trust: {
    readonly aiDisclaimer: string
    readonly nonAffiliationNotice: string
  }
  readonly regional: {
    readonly timeZone: string
    readonly clockConversionLocale: string
    readonly displayLocale: string
  }
  readonly eventCycle: {
    readonly yearBoundary: 'calendar-year'
    readonly queryYearMin: number
    readonly queryYearMax: number
    readonly typicalStart: { readonly monthIndex: number; readonly day: number }
    readonly typicalEnd: { readonly monthIndex: number; readonly day: number }
  }
  readonly branding: {
    readonly wordmark: string
    readonly appIconPath: string
  }
  readonly chatPolicy: {
    readonly conversationHistoryLimit: number
    readonly composerMaxLength: number
    readonly threadTitleMaxLength: number
    readonly offlineEventLimit: number
  }
  readonly persistence: {
    readonly namespace: string
    readonly chatThreadsStorageKey: string
    readonly installDismissedStorageKey: string
    readonly offlineKnowledge: {
      readonly databaseName: string
      readonly storeName: string
      readonly databaseVersion: number
    }
  }
}

// This checked-in object is the production deployment boundary. It deliberately
// reads no environment variables and contains no credentials or demo fallback.
const configuredProduct = {
  identity: {
    assistantName: 'Buglasan AI',
    festivalName: 'Buglasan Festival',
    festivalShortName: 'Buglasan',
    description: 'A multilingual, year-aware AI companion for the Buglasan Festival of Negros Oriental',
    aliases: ['Buglasan', 'Buglasan Festival'],
    vocabulary: ['festival', 'schedule', 'event', 'announcement', 'registration'],
  },
  languages: {
    default: 'en',
    supported: [
      { code: 'en', displayLabel: 'English', browserPrefixes: [] },
      { code: 'ceb', displayLabel: 'Cebuano/Bisaya', browserPrefixes: ['ceb'] },
      { code: 'fil', displayLabel: 'Filipino/Tagalog', browserPrefixes: ['fil', 'tl'] },
    ],
  },
  officialSource: {
    id: 'buglasan-facebook',
    authorityLabel: 'Official',
    pageLabel: 'Buglasan Festival Facebook Page',
    url: 'https://www.facebook.com/Buglasan',
  },
  trust: {
    aiDisclaimer: 'Buglasan AI may occasionally get details wrong.',
    nonAffiliationNotice: 'Data sourced from official channels. Not affiliated with the Provincial Government of Negros Oriental.',
  },
  regional: {
    timeZone: 'Asia/Manila',
    clockConversionLocale: 'en-US',
    displayLocale: 'en-PH',
  },
  eventCycle: {
    yearBoundary: 'calendar-year',
    queryYearMin: 2020,
    queryYearMax: 2030,
    typicalStart: { monthIndex: 9, day: 15 },
    typicalEnd: { monthIndex: 9, day: 25 },
  },
  branding: {
    wordmark: 'BUGLASAN AI',
    appIconPath: '/icons/icon-192.png',
  },
  chatPolicy: {
    conversationHistoryLimit: 6,
    composerMaxLength: 2000,
    threadTitleMaxLength: 48,
    offlineEventLimit: 6,
  },
  persistence: {
    namespace: 'buglasan-ai',
    chatThreadsStorageKey: 'buglasan-ai.chat-threads.v1',
    installDismissedStorageKey: 'buglasan-install-dismissed',
    offlineKnowledge: {
      databaseName: 'buglasan-ai-offline-knowledge',
      storeName: 'verified-snapshots',
      databaseVersion: 1,
    },
  },
} satisfies ProductConfig

function invalid(path: string, requirement: string): never {
  throw new Error(`Invalid product configuration at ${path}: ${requirement}`)
}

function objectAt(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'must be an object')
  const record = value as Record<string, unknown>
  const missing = keys.filter(key => !Object.hasOwn(record, key))
  const extra = Reflect.ownKeys(record).find(key => typeof key !== 'string' || !keys.includes(key))
  if (missing.length) invalid(`${path}.${missing[0]}`, 'is required')
  if (extra !== undefined) invalid(`${path}.${typeof extra === 'symbol' ? extra.toString() : extra}`, 'is not supported')
  return record
}

function trimmedString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) invalid(path, 'must be a non-empty trimmed string')
  return value
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) invalid(path, 'must be a non-empty string array')
  const result = value.map((item, index) => trimmedString(item, `${path}[${index}]`))
  if (new Set(result.map(item => item.toLocaleLowerCase())).size !== result.length) invalid(path, 'must not contain duplicates')
  return result
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) invalid(path, 'must be a positive integer')
  return value as number
}

function calendarPoint(value: unknown, path: string): { readonly monthIndex: number; readonly day: number } {
  const point = objectAt(value, path, ['monthIndex', 'day'])
  if (!Number.isInteger(point.monthIndex) || Number(point.monthIndex) < 0 || Number(point.monthIndex) > 11) {
    invalid(`${path}.monthIndex`, 'must be an integer from 0 through 11')
  }
  if (!Number.isInteger(point.day) || Number(point.day) <= 0) invalid(`${path}.day`, 'must be a positive integer')
  const date = new Date(2000, point.monthIndex as number, point.day as number)
  if (date.getMonth() !== point.monthIndex || date.getDate() !== point.day) invalid(`${path}.day`, 'must be valid for the configured month')
  return { monthIndex: point.monthIndex as number, day: point.day as number }
}

const SAFE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const SAFE_PATH = /^\/[a-zA-Z0-9._/-]+$/
const LANGUAGE_CODES = new Set<ProductLanguageCode>(['en', 'ceb', 'fil'])

export function assertValidProductConfig(input: unknown): asserts input is ProductConfig {
  const root = objectAt(input, 'productConfig', ['identity', 'languages', 'officialSource', 'trust', 'regional', 'eventCycle', 'branding', 'chatPolicy', 'persistence'])
  const identity = objectAt(root.identity, 'identity', ['assistantName', 'festivalName', 'festivalShortName', 'description', 'aliases', 'vocabulary'])
  for (const key of ['assistantName', 'festivalName', 'festivalShortName', 'description'] as const) trimmedString(identity[key], `identity.${key}`)
  stringArray(identity.aliases, 'identity.aliases')
  stringArray(identity.vocabulary, 'identity.vocabulary')

  const languages = objectAt(root.languages, 'languages', ['default', 'supported'])
  if (!LANGUAGE_CODES.has(languages.default as ProductLanguageCode)) invalid('languages.default', 'must be a supported language code')
  if (!Array.isArray(languages.supported) || languages.supported.length === 0) invalid('languages.supported', 'must be a non-empty array')
  const browserPrefixes = new Set<string>()
  const languageCodes = languages.supported.map((item, index) => {
    const language = objectAt(item, `languages.supported[${index}]`, ['code', 'displayLabel', 'browserPrefixes'])
    if (!LANGUAGE_CODES.has(language.code as ProductLanguageCode)) invalid(`languages.supported[${index}].code`, 'is not supported')
    trimmedString(language.displayLabel, `languages.supported[${index}].displayLabel`)
    if (!Array.isArray(language.browserPrefixes)) invalid(`languages.supported[${index}].browserPrefixes`, 'must be a string array')
    const prefixes = language.browserPrefixes.map((prefix, prefixIndex) => trimmedString(prefix, `languages.supported[${index}].browserPrefixes[${prefixIndex}]`))
    if (prefixes.some(prefix => !/^[a-z]{2,3}$/.test(prefix))) invalid(`languages.supported[${index}].browserPrefixes`, 'must contain lowercase language prefixes')
    prefixes.forEach((prefix, prefixIndex) => {
      if (browserPrefixes.has(prefix)) invalid(`languages.supported[${index}].browserPrefixes[${prefixIndex}]`, 'must be unique across supported languages')
      browserPrefixes.add(prefix)
    })
    return language.code as ProductLanguageCode
  })
  if (new Set(languageCodes).size !== languageCodes.length) invalid('languages.supported', 'must have unique language codes')
  if (!languageCodes.includes(languages.default as ProductLanguageCode)) invalid('languages.default', 'must appear in languages.supported')

  const officialSource = objectAt(root.officialSource, 'officialSource', ['id', 'authorityLabel', 'pageLabel', 'url'])
  for (const key of ['id', 'authorityLabel', 'pageLabel', 'url'] as const) trimmedString(officialSource[key], `officialSource.${key}`)
  if (!SAFE_ID.test(officialSource.id as string)) invalid('officialSource.id', 'must be a safe lowercase identifier')
  let officialUrl: URL
  try { officialUrl = new URL(officialSource.url as string) } catch { invalid('officialSource.url', 'must be a valid URL') }
  if (officialUrl.protocol !== 'https:' || officialUrl.username || officialUrl.password) invalid('officialSource.url', 'must be credential-free HTTPS')
  if (officialUrl.search || officialUrl.hash) invalid('officialSource.url', 'must not contain a query string or fragment')

  const trust = objectAt(root.trust, 'trust', ['aiDisclaimer', 'nonAffiliationNotice'])
  trimmedString(trust.aiDisclaimer, 'trust.aiDisclaimer')
  trimmedString(trust.nonAffiliationNotice, 'trust.nonAffiliationNotice')

  const regional = objectAt(root.regional, 'regional', ['timeZone', 'clockConversionLocale', 'displayLocale'])
  for (const key of ['timeZone', 'clockConversionLocale', 'displayLocale'] as const) trimmedString(regional[key], `regional.${key}`)
  for (const key of ['clockConversionLocale', 'displayLocale'] as const) {
    try { new Intl.DateTimeFormat(regional[key] as string) } catch { invalid(`regional.${key}`, 'must be a supported locale') }
  }
  try { new Intl.DateTimeFormat(regional.displayLocale as string, { timeZone: regional.timeZone as string }).format(0) } catch { invalid('regional.timeZone', 'must be a supported IANA time zone') }

  const eventCycle = objectAt(root.eventCycle, 'eventCycle', ['yearBoundary', 'queryYearMin', 'queryYearMax', 'typicalStart', 'typicalEnd'])
  if (eventCycle.yearBoundary !== 'calendar-year') invalid('eventCycle.yearBoundary', 'must be calendar-year')
  if (!Number.isInteger(eventCycle.queryYearMin)) invalid('eventCycle.queryYearMin', 'must be an integer')
  if (!Number.isInteger(eventCycle.queryYearMax)) invalid('eventCycle.queryYearMax', 'must be an integer')
  if (Number(eventCycle.queryYearMin) > Number(eventCycle.queryYearMax)) invalid('eventCycle.queryYearMin', 'must not exceed eventCycle.queryYearMax')
  const typicalStart = calendarPoint(eventCycle.typicalStart, 'eventCycle.typicalStart')
  const typicalEnd = calendarPoint(eventCycle.typicalEnd, 'eventCycle.typicalEnd')
  if (typicalStart.monthIndex * 32 + typicalStart.day > typicalEnd.monthIndex * 32 + typicalEnd.day) invalid('eventCycle.typicalStart', 'must not be after eventCycle.typicalEnd')

  const branding = objectAt(root.branding, 'branding', ['wordmark', 'appIconPath'])
  trimmedString(branding.wordmark, 'branding.wordmark')
  if (!SAFE_PATH.test(trimmedString(branding.appIconPath, 'branding.appIconPath'))) invalid('branding.appIconPath', 'must be a safe root-relative path')

  const chatPolicy = objectAt(root.chatPolicy, 'chatPolicy', ['conversationHistoryLimit', 'composerMaxLength', 'threadTitleMaxLength', 'offlineEventLimit'])
  for (const key of ['conversationHistoryLimit', 'composerMaxLength', 'threadTitleMaxLength', 'offlineEventLimit'] as const) positiveInteger(chatPolicy[key], `chatPolicy.${key}`)

  const persistence = objectAt(root.persistence, 'persistence', ['namespace', 'chatThreadsStorageKey', 'installDismissedStorageKey', 'offlineKnowledge'])
  for (const key of ['namespace', 'chatThreadsStorageKey', 'installDismissedStorageKey'] as const) trimmedString(persistence[key], `persistence.${key}`)
  if (!SAFE_ID.test(persistence.namespace as string)) invalid('persistence.namespace', 'must be a safe lowercase namespace')
  if (!(persistence.chatThreadsStorageKey as string).startsWith(persistence.namespace as string) || !(persistence.installDismissedStorageKey as string).startsWith((persistence.namespace as string).replace(/-ai$/, ''))) {
    invalid('persistence', 'storage keys must remain within the configured namespace')
  }
  if (persistence.chatThreadsStorageKey === persistence.installDismissedStorageKey) invalid('persistence.installDismissedStorageKey', 'must differ from persistence.chatThreadsStorageKey')
  const offline = objectAt(persistence.offlineKnowledge, 'persistence.offlineKnowledge', ['databaseName', 'storeName', 'databaseVersion'])
  for (const key of ['databaseName', 'storeName'] as const) {
    const value = trimmedString(offline[key], `persistence.offlineKnowledge.${key}`)
    if (!SAFE_ID.test(value)) invalid(`persistence.offlineKnowledge.${key}`, 'must be a safe lowercase identifier')
  }
  if (!(offline.databaseName as string).startsWith(persistence.namespace as string)) invalid('persistence.offlineKnowledge.databaseName', 'must remain within the configured namespace')
  positiveInteger(offline.databaseVersion, 'persistence.offlineKnowledge.databaseVersion')

  const publicValues: string[] = []
  const visited = new Set<object>()
  const collectPublicValues = (value: unknown): void => {
    if (typeof value === 'string') { publicValues.push(value); return }
    if (!value || typeof value !== 'object' || visited.has(value)) return
    visited.add(value)
    Reflect.ownKeys(value).forEach(key => {
      if (typeof key === 'string') publicValues.push(key)
      collectPublicValues(Reflect.get(value, key))
    })
  }
  collectPublicValues(input)
  const publicText = publicValues.join('\n')
  const hasUnsafeMarker = /demo fixture|demo_|api[ _-]?key|client[ _-]?secret|access[ _-]?token|password|private[ _-]?key/i.test(publicText)
  const hasRecognizableCredential = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b(?:sk|gh[pousr])[-_][A-Za-z0-9_-]{12,}/.test(publicText)
  if (hasUnsafeMarker || hasRecognizableCredential) invalid('productConfig', 'must not contain demo markers or obvious credential/token indicators')
}

function deepFreeze<T extends object>(value: T): Readonly<T> {
  Reflect.ownKeys(value).forEach(key => {
    const nested = Reflect.get(value, key)
    if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) deepFreeze(nested)
  })
  return Object.freeze(value)
}

export function defineProductConfig(input: unknown): ProductConfig {
  assertValidProductConfig(input)
  return deepFreeze(input)
}

export const productConfig = defineProductConfig(configuredProduct)
