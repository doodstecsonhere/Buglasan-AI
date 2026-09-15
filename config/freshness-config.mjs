// Public, secret-free Phase 4 deployment freshness policy.
export const buglasanFreshnessConfig = {
  deploymentId: 'buglasan',
  identity: { assistantName: 'Buglasan AI', eventName: 'Buglasan Festival' },
  freshness: {
    thresholds: { agingAfterHours: 24, staleAfterHours: 72 },
    timeZone: 'Asia/Manila',
    dateTimeLocale: 'en-PH',
  },
}
