export const syntheticDeploymentBranding = {
  product: {
    assistantName: 'Harbor Guide', eventName: 'Harbor Lights Festival', eventShortName: 'Harbor Lights',
    description: 'A multilingual guide for the synthetic Harbor Lights Festival', officialUrl: 'https://www.facebook.com/HarborLightsOfficial',
    wordmark: 'HARBOR GUIDE', avatarPath: '/brand/harbor-guide.png', avatarAlt: 'Harbor Guide',
  },
  deployment: { id: 'staging-blue', storageNamespace: 'harbor-guide', cacheVersion: 'v1' },
  metadata: { htmlDescription: 'Ask Harbor Guide for cited event information.', socialDescription: 'Cited multilingual harbor event guidance.' },
  locale: { htmlLanguage: 'fil', manifestLanguage: 'fil-PH', openGraphLocale: 'fil_PH' },
  colors: { theme: '#123456', background: '#234567', offlineTheme: '#345678' },
  pwa: { shortName: 'Harbor PWA', id: '/', startUrl: '/', scope: '/', display: 'standalone', orientation: 'portrait', categories: ['events', 'education'] },
  assets: {
    favicon: { source: 'public/favicon.svg', publicPath: '/favicon.svg', mediaType: 'image/svg+xml' },
    logo: { source: 'public/brand/harbor-guide.png', publicPath: '/brand/harbor-guide.png', width: 1254, height: 1254, mediaType: 'image/png' },
    icons: [
      { source: 'public/icons/harbor-192.png', publicPath: '/icons/harbor-192.png', width: 192, height: 192, purpose: 'any' },
      { source: 'public/icons/harbor-512.png', publicPath: '/icons/harbor-512.png', width: 512, height: 512, purpose: 'any' },
      { source: 'public/icons/harbor-maskable.png', publicPath: '/icons/harbor-maskable.png', width: 512, height: 512, purpose: 'maskable' },
    ],
    appleTouchIcon: { source: 'public/icons/harbor-apple.png', publicPath: '/icons/harbor-apple.png', width: 180, height: 180, mediaType: 'image/png' },
  },
  offline: { symbol: '⚓', heading: 'Harbor Guide is offline', message: 'Reconnect for the latest Harbor Lights Festival information.' },
}
