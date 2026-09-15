import { deploymentBranding } from './deployment-branding.mjs'

// This is a build-time contract for the one Buglasan static release. It is not
// runtime event selection and does not describe credentials or infrastructure.
export const eventReleasePackage = Object.freeze({
  schemaVersion: 'event-release-package/v1',
  packageId: 'buglasan-ai',
  outputDirectory: 'dist',
  hosting: Object.freeze({
    protocol: 'https',
    historyFallback: '/index.html',
    entrypoint: '/index.html',
  }),
  product: Object.freeze({
    assistantName: deploymentBranding.product.assistantName,
    eventName: deploymentBranding.product.eventName,
    officialUrl: deploymentBranding.product.officialUrl,
  }),
})
