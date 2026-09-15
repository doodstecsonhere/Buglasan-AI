import { defineEventReleasePackage } from '../../config/release-package.mjs'
import { syntheticDeploymentBranding } from './pwa-synthetic-branding.mjs'

// Test-only proof target. It is deliberately absent from production definitions.
export const harborReferenceReleasePackage = defineEventReleasePackage({
  schemaVersion: 'event-release-package/v1',
  targetId: 'harbor-reference',
  deploymentClass: 'reference-only',
  packageId: 'harbor-guide-reference',
  outputDirectory: 'harbor-reference-dist',
  hosting: { protocol: 'https', historyFallback: '/index.html', entrypoint: '/index.html' },
  product: {
    assistantName: syntheticDeploymentBranding.product.assistantName,
    eventName: syntheticDeploymentBranding.product.eventName,
    officialUrl: syntheticDeploymentBranding.product.officialUrl,
  },
  branding: syntheticDeploymentBranding,
})
