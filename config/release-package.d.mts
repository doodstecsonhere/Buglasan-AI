import type { DeploymentBranding } from '../build/pwa-static.mjs'

export interface EventReleasePackage {
  readonly schemaVersion: 'event-release-package/v1'
  readonly targetId: string
  readonly deploymentClass: 'production' | 'reference-only'
  readonly packageId: string
  readonly outputDirectory: string
  readonly hosting: Readonly<{ protocol: 'https'; historyFallback: '/index.html'; entrypoint: '/index.html' }>
  readonly product: Readonly<{ assistantName: string; eventName: string; officialUrl: string }>
  readonly branding: DeploymentBranding
}

export function defineEventReleasePackage(input: unknown): EventReleasePackage
export function selectEventReleasePackage(definitions: readonly unknown[], targetId: string, options?: { allowReference?: boolean }): EventReleasePackage
export const eventReleasePackageDefinitions: readonly EventReleasePackage[]
export function selectProductionEventReleasePackage(): EventReleasePackage
export const eventReleasePackage: EventReleasePackage
export const PRODUCTION_TARGET: 'buglasan-production'
