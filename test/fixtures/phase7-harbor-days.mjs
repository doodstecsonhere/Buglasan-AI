export const harborDaysReferenceDeployment = Object.freeze({
  product: Object.freeze({
    assistantName: 'Harbor Days Guide',
    eventName: 'Harbor Days',
    eventShortName: 'Harbor Days',
    aliases: Object.freeze(['Harbor Days', 'Harbor Days Festival', 'HD Gathering']),
    languages: Object.freeze(['en', 'es', 'fr']),
    timeZone: 'America/New_York',
    verificationUrl: 'https://harbordays.example.org/official',
    nonAffiliationNotice: 'Independent community information; not affiliated with Harbor Days organizers.',
  }),
  deployment: Object.freeze({
    id: 'harbor-days-reference',
    storageNamespace: 'harbor-days-guide',
    cacheVersion: 'v7-reference',
    offlineDatabase: 'harbor-days-guide-offline-knowledge',
  }),
  freshness: Object.freeze({ agingAfterHours: 6, staleAfterHours: 18 }),
  knowledge: Object.freeze({
    cycle: 2031,
    text: 'Harbor Days lantern walk begins at Pier Nine on June 14, 2031 at 7:30 PM.',
    aliases: Object.freeze(['lantern walk', 'Pier Nine']),
  }),
  source: Object.freeze({
    type: 'facebook',
    identity: 'harbor-days-2031-lantern-walk',
    reference: 'https://www.facebook.com/HarborDays/posts/harbor-days-2031-lantern-walk',
    acquisition: Object.freeze({
      state: 'operator_provided_content',
      collectionMethod: 'manual',
      provenance: 'operator_provided',
    }),
  }),
})
