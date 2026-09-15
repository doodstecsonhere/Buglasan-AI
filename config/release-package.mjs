import { deploymentBranding } from './deployment-branding.mjs'
import { validateDeploymentBranding } from '../build/pwa-static.mjs'

const SAFE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const SAFE_OUTPUT_DIRECTORY = /^(?!.*(?:^|[\\/])\.\.?[\\/])[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const PRODUCTION_TARGET = 'buglasan-production'

function fail(path, message) { throw new Error(`Invalid event release package at ${path}: ${message}`) }
function exactObject(value, path, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object')
  const ownKeys = Reflect.ownKeys(value)
  const missing = keys.find(key => !ownKeys.includes(key))
  const extra = ownKeys.find(key => typeof key !== 'string' || !keys.includes(key))
  if (missing) fail(`${path}.${missing}`, 'is required')
  if (extra !== undefined) fail(`${path}.${String(extra)}`, 'is not supported')
  return value
}
function text(value, path) {
  if (typeof value !== 'string' || !value || value.trim() !== value) fail(path, 'must be a non-empty trimmed string')
  return value
}

/** Validates a build-time package definition; it never creates runtime event selection. */
export function defineEventReleasePackage(input) {
  const config = exactObject(input, 'eventReleasePackage', ['schemaVersion', 'targetId', 'deploymentClass', 'packageId', 'outputDirectory', 'hosting', 'product', 'branding'])
  if (text(config.schemaVersion, 'schemaVersion') !== 'event-release-package/v1') fail('schemaVersion', 'must be event-release-package/v1')
  for (const key of ['targetId', 'packageId']) if (!SAFE_ID.test(text(config[key], key))) fail(key, 'must be a safe lowercase identifier')
  if (!['production', 'reference-only'].includes(config.deploymentClass)) fail('deploymentClass', 'must be production or reference-only')
  if (!SAFE_OUTPUT_DIRECTORY.test(text(config.outputDirectory, 'outputDirectory'))) fail('outputDirectory', 'must be a safe relative directory name')
  const hosting = exactObject(config.hosting, 'hosting', ['protocol', 'historyFallback', 'entrypoint'])
  if (hosting.protocol !== 'https' || hosting.historyFallback !== '/index.html' || hosting.entrypoint !== '/index.html') fail('hosting', 'must retain HTTPS root SPA hosting')
  const product = exactObject(config.product, 'product', ['assistantName', 'eventName', 'officialUrl'])
  for (const key of Object.keys(product)) text(product[key], `product.${key}`)
  if (!/^https:\/\//.test(product.officialUrl)) fail('product.officialUrl', 'must be HTTPS')
  validateDeploymentBranding(config.branding)
  for (const key of Object.keys(product)) if (product[key] !== config.branding.product[key]) fail(`product.${key}`, 'must match branding.product')
  return Object.freeze({ ...config, hosting: Object.freeze({ ...hosting }), product: Object.freeze({ ...product }) })
}

/**
 * Selects a named package target. The target is always explicit at the call
 * boundary: production callers pass the immutable Buglasan target, while
 * reference callers must additionally assert their test-only intent.
 */
export function selectEventReleasePackage(definitions, targetId, { allowReference = false } = {}) {
  if (!Array.isArray(definitions) || !definitions.length) fail('definitions', 'must be a non-empty array')
  if (typeof targetId !== 'string' || !targetId) fail('targetId', 'must explicitly name a configured package target')
  const validated = definitions.map(defineEventReleasePackage)
  if (new Set(validated.map(definition => definition.targetId)).size !== validated.length) fail('definitions', 'targetId values must be unique')
  const selected = validated.find(definition => definition.targetId === targetId)
  if (!selected) fail('targetId', `does not name a configured package target: ${targetId}`)
  if (selected.deploymentClass === 'reference-only' && !allowReference) fail('targetId', `${targetId} is reference-only and cannot be selected for a production build`)
  return selected
}

export const eventReleasePackageDefinitions = Object.freeze([
  defineEventReleasePackage({
    schemaVersion: 'event-release-package/v1',
    targetId: PRODUCTION_TARGET,
    deploymentClass: 'production',
    packageId: 'buglasan-ai',
    outputDirectory: 'dist',
    hosting: { protocol: 'https', historyFallback: '/index.html', entrypoint: '/index.html' },
    product: {
      assistantName: deploymentBranding.product.assistantName,
      eventName: deploymentBranding.product.eventName,
      officialUrl: deploymentBranding.product.officialUrl,
    },
    branding: deploymentBranding,
  }),
])

/** Production builds have exactly one target and never read a target selector. */
export function selectProductionEventReleasePackage() {
  return selectEventReleasePackage(eventReleasePackageDefinitions, PRODUCTION_TARGET)
}

// Compatibility export and the immutable default production package contract.
export const eventReleasePackage = selectProductionEventReleasePackage()
export { PRODUCTION_TARGET }
