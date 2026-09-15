// Browser and build tooling consume this one checked-in product definition.
// It is public configuration only: no environment variables, credentials, or demo fallback.
export const configuredProduct = {
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
  regional: { timeZone: 'Asia/Manila', clockConversionLocale: 'en-US', displayLocale: 'en-PH' },
  eventCycle: {
    yearBoundary: 'calendar-year', queryYearMin: 2020, queryYearMax: 2030,
    typicalStart: { monthIndex: 9, day: 15 }, typicalEnd: { monthIndex: 9, day: 25 },
  },
  branding: {
    wordmark: 'BUGLASAN AI',
    quickQuestions: ['What are the Buglasan events for today?', 'What are the Buglasan events tomorrow?', "What's the latest update?"],
    appIconPath: '/icons/icon-192.png',
    assistantAvatarPath: '/icons/icon-192.png',
    assistantAvatarAlt: 'Buglasan AI',
  },
  chatPolicy: { conversationHistoryLimit: 6, composerMaxLength: 2000, threadTitleMaxLength: 48, offlineEventLimit: 6 },
  persistence: {
    namespace: 'buglasan-ai', chatThreadsStorageKey: 'buglasan-ai.chat-threads.v1', installDismissedStorageKey: 'buglasan-install-dismissed',
    offlineKnowledge: { databaseName: 'buglasan-ai-offline-knowledge', storeName: 'verified-snapshots', databaseVersion: 1 },
  },
}
