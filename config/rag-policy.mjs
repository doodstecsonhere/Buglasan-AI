// Runtime-neutral public policy shared by browser checks and Supabase chat.
// This module is static by design: no environment lookup, credentials, or fixture selection.

export const genericRagPrinciples = deepFreeze({
  evidence: {
    unknownIsNotNo: true,
    zeroEvidenceRequiresFallback: true,
    exactYearIsolation: true,
    supersessionAware: true,
    citationsRequired: true,
  },
  provenance: {
    operatorCuratedIsNotOfficial: true,
    officialSourceDoesNotImplyOfficialProduct: true,
  },
})

const configuredDeployment = {
  identity: {
    assistantName: 'Buglasan AI',
    festivalName: 'Buglasan Festival',
    description: 'a multilingual, year-aware AI companion for the Buglasan Festival of Negros Oriental, Philippines',
    productStatus: 'unofficial',
    knowledgeStewardship: 'operator-curated',
  },
  regional: { timeZone: 'Asia/Manila' },
  languages: {
    default: 'en',
    supported: [
      { code: 'en', label: 'English' },
      { code: 'ceb', label: 'Cebuano/Bisaya' },
      { code: 'fil', label: 'Filipino/Tagalog' },
    ],
  },
  years: { minimum: 2020, maximum: 2030, defaultBehavior: 'current-calendar-year' },
  verification: {
    authority: 'official-source',
    label: 'official Buglasan Festival Facebook Page',
    url: 'https://www.facebook.com/Buglasan',
  },
  citations: {
    required: true,
    platform: 'facebook',
    host: 'www.facebook.com',
    pagePath: '/Buglasan',
    postPathPrefix: '/Buglasan/posts/',
  },
  chat: { conversationHistoryLimit: 6 },
}

const ROOT_KEYS = ['identity', 'regional', 'languages', 'years', 'verification', 'citations', 'chat']

function fail(path, requirement) {
  throw new Error(`Invalid RAG policy at ${path}: ${requirement}`)
}

function exactObject(value, path, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object')
  const ownKeys = Reflect.ownKeys(value)
  const missing = keys.find((key) => !Object.hasOwn(value, key))
  const extra = ownKeys.find((key) => typeof key !== 'string' || !keys.includes(key))
  if (missing) fail(`${path}.${missing}`, 'is required')
  if (extra !== undefined) fail(`${path}.${String(extra)}`, 'is not supported')
  return value
}

function text(value, path) {
  if (typeof value !== 'string' || !value || value.trim() !== value) fail(path, 'must be a non-empty trimmed string')
  return value
}

function positiveInteger(value, path) {
  if (!Number.isInteger(value) || value <= 0) fail(path, 'must be a positive integer')
  return value
}

function credentialFreeHttps(value, path) {
  let url
  try { url = new URL(text(value, path)) } catch { fail(path, 'must be a valid URL') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    fail(path, 'must be credential-free HTTPS without query or fragment')
  }
  return url
}

function assertCredentialFree(value) {
  const strings = []
  const visit = (item) => {
    if (typeof item === 'string') { strings.push(item); return }
    if (!item || typeof item !== 'object') return
    Reflect.ownKeys(item).forEach((key) => {
      strings.push(String(key))
      visit(Reflect.get(item, key))
    })
  }
  visit(value)
  const content = strings.join('\n')
  if (/demo fixture|demo_|api[ _-]?key|client[ _-]?secret|access[ _-]?token|password|private[ _-]?key/i.test(content) ||
      /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b(?:sk|gh[pousr])[-_][A-Za-z0-9_-]{12,}/.test(content)) {
    fail('ragPolicy', 'must not contain fixture markers or recognizable credential indicators')
  }
}

export function assertValidRagPolicy(input) {
  const root = exactObject(input, 'ragPolicy', ROOT_KEYS)
  const identity = exactObject(root.identity, 'identity', ['assistantName', 'festivalName', 'description', 'productStatus', 'knowledgeStewardship'])
  ;['assistantName', 'festivalName', 'description'].forEach((key) => text(identity[key], `identity.${key}`))
  if (identity.productStatus !== 'unofficial') fail('identity.productStatus', 'must explicitly be unofficial')
  if (identity.knowledgeStewardship !== 'operator-curated') fail('identity.knowledgeStewardship', 'must explicitly be operator-curated')

  const regional = exactObject(root.regional, 'regional', ['timeZone'])
  try { new Intl.DateTimeFormat('en', { timeZone: text(regional.timeZone, 'regional.timeZone') }).format(0) } catch { fail('regional.timeZone', 'must be an IANA time zone') }

  const languages = exactObject(root.languages, 'languages', ['default', 'supported'])
  text(languages.default, 'languages.default')
  if (!Array.isArray(languages.supported) || languages.supported.length === 0) fail('languages.supported', 'must be a non-empty array')
  const codes = languages.supported.map((item, index) => {
    const language = exactObject(item, `languages.supported[${index}]`, ['code', 'label'])
    return text(language.code, `languages.supported[${index}].code`) && text(language.label, `languages.supported[${index}].label`) && language.code
  })
  if (new Set(codes).size !== codes.length || !codes.includes(languages.default)) fail('languages', 'must have unique codes including the default')

  const years = exactObject(root.years, 'years', ['minimum', 'maximum', 'defaultBehavior'])
  positiveInteger(years.minimum, 'years.minimum'); positiveInteger(years.maximum, 'years.maximum')
  if (years.minimum > years.maximum) fail('years.minimum', 'must not exceed years.maximum')
  if (years.defaultBehavior !== 'current-calendar-year') fail('years.defaultBehavior', 'must be current-calendar-year')

  const verification = exactObject(root.verification, 'verification', ['authority', 'label', 'url'])
  if (verification.authority !== 'official-source') fail('verification.authority', 'must describe source authority, not product affiliation')
  text(verification.label, 'verification.label')
  const verificationUrl = credentialFreeHttps(verification.url, 'verification.url')

  const citations = exactObject(root.citations, 'citations', ['required', 'platform', 'host', 'pagePath', 'postPathPrefix'])
  if (citations.required !== true) fail('citations.required', 'must be true')
  ;['platform', 'host', 'pagePath', 'postPathPrefix'].forEach((key) => text(citations[key], `citations.${key}`))
  if (verificationUrl.hostname !== citations.host || verificationUrl.pathname.replace(/\/$/, '') !== citations.pagePath) fail('citations', 'must match the verification destination')
  if (!citations.postPathPrefix.startsWith(`${citations.pagePath}/posts/`)) fail('citations.postPathPrefix', 'must be under the configured page path')

  const chat = exactObject(root.chat, 'chat', ['conversationHistoryLimit'])
  positiveInteger(chat.conversationHistoryLimit, 'chat.conversationHistoryLimit')
  assertCredentialFree(input)
}

function deepFreeze(value) {
  Reflect.ownKeys(value).forEach((key) => {
    const nested = Reflect.get(value, key)
    if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) deepFreeze(nested)
  })
  return Object.freeze(value)
}

export function defineRagPolicy(input) {
  assertValidRagPolicy(input)
  return deepFreeze(input)
}

export function assertProductRagParity(product, policy) {
  const expected = {
    assistantName: product.identity.assistantName,
    festivalName: product.identity.festivalName,
    timeZone: product.regional.timeZone,
    languages: product.languages.supported.map(({ code, displayLabel }) => ({ code, label: displayLabel })),
    defaultLanguage: product.languages.default,
    minimumYear: product.eventCycle.queryYearMin,
    maximumYear: product.eventCycle.queryYearMax,
    verificationUrl: product.officialSource.url,
    historyLimit: product.chatPolicy.conversationHistoryLimit,
  }
  const actual = {
    assistantName: policy.identity.assistantName,
    festivalName: policy.identity.festivalName,
    timeZone: policy.regional.timeZone,
    languages: policy.languages.supported,
    defaultLanguage: policy.languages.default,
    minimumYear: policy.years.minimum,
    maximumYear: policy.years.maximum,
    verificationUrl: policy.verification.url,
    historyLimit: policy.chat.conversationHistoryLimit,
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Browser/server RAG policy parity check failed')
  return true
}

export const ragPolicy = defineRagPolicy(configuredDeployment)
