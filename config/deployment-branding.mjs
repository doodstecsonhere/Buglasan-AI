import { configuredProduct } from './product-config.mjs'

const { identity, officialSource, regional, branding, persistence } = configuredProduct

// Static deployment details extend the shared product identity rather than
// defining another product. Cache identity is derived from deployment + storage.
export const deploymentBranding = Object.freeze({
  product: Object.freeze({
    assistantName: identity.assistantName,
    eventName: identity.festivalName,
    eventShortName: identity.festivalShortName,
    description: identity.description,
    officialUrl: officialSource.url,
    wordmark: branding.wordmark,
    avatarPath: branding.assistantAvatarPath,
    avatarAlt: branding.assistantAvatarAlt,
  }),
  deployment: Object.freeze({ id: 'production', storageNamespace: persistence.namespace, cacheVersion: 'v5-offline-knowledge' }),
  metadata: Object.freeze({
    htmlDescription: 'Ask Buglasan AI for cited, year-aware festival information in English, Bisaya, or Filipino.',
    socialDescription: 'Cited, year-aware festival guidance in English, Bisaya, and Filipino.',
  }),
  locale: Object.freeze({ htmlLanguage: 'en', manifestLanguage: regional.displayLocale, openGraphLocale: 'en_PH' }),
  colors: Object.freeze({ theme: '#07174F', background: '#07174F', offlineTheme: '#E53E3E' }),
  pwa: Object.freeze({ shortName: 'Buglasan AI', id: '/', startUrl: '/', scope: '/', display: 'standalone', orientation: 'portrait', categories: Object.freeze(['festival', 'events', 'travel', 'lifestyle']) }),
  assets: Object.freeze({
    favicon: Object.freeze({ source: 'public/favicon.svg', publicPath: '/favicon.svg', mediaType: 'image/svg+xml' }),
    logo: Object.freeze({ source: 'public/brand/buglasan-ai-canonical.png', publicPath: '/brand/buglasan-ai-canonical.png', width: 1254, height: 1254, mediaType: 'image/png' }),
    icons: Object.freeze([
      Object.freeze({ source: 'public/icons/icon-192.png', publicPath: '/icons/icon-192.png', width: 192, height: 192, purpose: 'any' }),
      Object.freeze({ source: 'public/icons/icon-512.png', publicPath: '/icons/icon-512.png', width: 512, height: 512, purpose: 'any' }),
      Object.freeze({ source: 'public/icons/icon-512-maskable.png', publicPath: '/icons/icon-512-maskable.png', width: 512, height: 512, purpose: 'maskable' }),
    ]),
    appleTouchIcon: Object.freeze({ source: 'public/icons/apple-touch-icon.png', publicPath: '/icons/apple-touch-icon.png', width: 180, height: 180, mediaType: 'image/png' }),
  }),
  offline: Object.freeze({ symbol: '🎭', heading: 'Buglasan AI is offline', message: 'Reconnect to load the latest festival information. Previously saved chats remain on this device.' }),
})
