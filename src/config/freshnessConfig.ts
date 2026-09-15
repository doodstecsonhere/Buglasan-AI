import { buglasanFreshnessConfig as configuredBuglasanFreshness } from '../../config/freshness-config.mjs'
import { validateFreshnessPolicy, type FreshnessPolicy } from '../utils/freshness'

export interface DeploymentFreshnessConfig {
  readonly deploymentId: string
  readonly identity: { readonly assistantName: string; readonly eventName: string }
  readonly freshness: FreshnessPolicy
}

function invalid(path: string, requirement: string): never {
  throw new Error(`Invalid deployment freshness configuration at ${path}: ${requirement}`)
}

export function defineDeploymentFreshnessConfig(input: unknown): DeploymentFreshnessConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('config', 'must be an object')
  const value = input as Record<string, unknown>
  if (typeof value.deploymentId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.deploymentId)) invalid('deploymentId', 'must be a safe lowercase identifier')
  if (!value.identity || typeof value.identity !== 'object' || Array.isArray(value.identity)) invalid('identity', 'must be an object')
  const identity = value.identity as Record<string, unknown>
  if (typeof identity.assistantName !== 'string' || !identity.assistantName.trim()) invalid('identity.assistantName', 'must be a non-empty string')
  if (typeof identity.eventName !== 'string' || !identity.eventName.trim()) invalid('identity.eventName', 'must be a non-empty string')
  const freshness = validateFreshnessPolicy(value.freshness)
  return Object.freeze({
    deploymentId: value.deploymentId,
    identity: Object.freeze({ assistantName: identity.assistantName, eventName: identity.eventName }),
    freshness,
  })
}

export const buglasanFreshnessConfig = defineDeploymentFreshnessConfig(configuredBuglasanFreshness)
