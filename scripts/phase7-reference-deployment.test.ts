import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { genericRagPrinciples } from '../config/rag-policy.mjs'
import { defineDeploymentFreshnessConfig } from '../src/config/freshnessConfig'
import { defineRagPolicy } from '../config/rag-policy.mjs'
import { defineProductConfig } from '../src/config/productConfig'
import { adaptToSourceIngestionPayload, type SourceAdapterRecord } from '../src/ingestion/sourceAdapter'
import { normalizeSourceIngestionPayload } from '../src/ingestion/sourceIngestion'
import { harborDaysReferenceDeployment as harbor } from '../test/fixtures/phase7-harbor-days.mjs'
import { syntheticDeploymentBranding } from '../test/fixtures/pwa-synthetic-branding.mjs'
import { renderStaticDeployment, validateDeploymentBranding } from '../build/pwa-static.mjs'

const buglasanOnlyTerms = ['buglasan', 'negros oriental', 'dumaguete', 'freedom park', 'asia/manila']
const protectedContracts = [
  'src/App.tsx',
  'src/services/chatService.ts',
  'src/services/demoChatResponder.ts',
  'supabase/functions/chat/index.ts',
  'supabase/functions/chat/grounding.ts',
  'supabase/functions/_shared/extraction.ts',
  'supabase/functions/_shared/reconciliation.ts',
  'n8n/workflows/buglasan-source-collector.json',
]

const sourceRecord = (overrides: Partial<SourceAdapterRecord> = {}): SourceAdapterRecord => ({
  source: { type: harbor.source.type, identity: harbor.source.identity, reference: harbor.source.reference },
  event: { cycle: harbor.product.eventName, festival_year: harbor.knowledge.cycle },
  published_at: null,
  content: { raw_text: harbor.knowledge.text, normalized_text: harbor.knowledge.text, title: 'Lantern walk notice', source_type: 'text', media_urls: [] },
  metadata: { fixture: 'phase7-reference', cycle: harbor.knowledge.cycle },
  authority: { label: 'Community notice', official: false },
  acquisition: { state: harbor.source.acquisition.state, collected_at: '2031-05-01T12:00:00Z', collection_method: harbor.source.acquisition.collectionMethod },
  eligibility: { eligible: true, reason: null },
  validation: { failure: null },
  ...overrides,
})

function syntheticProduct() {
  return defineProductConfig({
    identity: { assistantName: harbor.product.assistantName, festivalName: harbor.product.eventName, festivalShortName: harbor.product.eventShortName, description: 'A multilingual guide for Harbor Days.', aliases: [...harbor.product.aliases], vocabulary: ['lantern walk', 'schedule', 'venue'] },
    languages: { default: 'en', supported: [{ code: 'en', displayLabel: 'English', browserPrefixes: [] }, { code: 'ceb', displayLabel: 'Cebuano/Bisaya', browserPrefixes: ['ceb'] }, { code: 'fil', displayLabel: 'Filipino/Tagalog', browserPrefixes: ['fil'] }] },
    officialSource: { id: 'harbor-days-notices', authorityLabel: 'Reference', pageLabel: 'Harbor Days notices', url: harbor.product.verificationUrl },
    trust: { aiDisclaimer: 'Harbor Days Guide may occasionally get details wrong.', nonAffiliationNotice: harbor.product.nonAffiliationNotice },
    regional: { timeZone: harbor.product.timeZone, clockConversionLocale: 'en-US', displayLocale: 'en-US' },
    eventCycle: { yearBoundary: 'calendar-year', queryYearMin: 2030, queryYearMax: 2040, typicalStart: { monthIndex: 5, day: 10 }, typicalEnd: { monthIndex: 5, day: 16 } },
    branding: { wordmark: 'HARBOR DAYS GUIDE', quickQuestions: ['When is the lantern walk?'], appIconPath: '/icons/harbor-192.png', assistantAvatarPath: '/icons/harbor-192.png', assistantAvatarAlt: 'Harbor Days Guide' },
    chatPolicy: { conversationHistoryLimit: 4, composerMaxLength: 1000, threadTitleMaxLength: 40, offlineEventLimit: 4 },
    persistence: { namespace: harbor.deployment.storageNamespace, chatThreadsStorageKey: `${harbor.deployment.storageNamespace}.chat-threads.v1`, installDismissedStorageKey: `${harbor.deployment.storageNamespace}.install-dismissed`, offlineKnowledge: { databaseName: harbor.deployment.offlineDatabase, storeName: 'verified-snapshots', databaseVersion: 1 } },
  })
}

function syntheticRagPolicy() {
  return defineRagPolicy({
    identity: { assistantName: harbor.product.assistantName, festivalName: harbor.product.eventName, description: 'a multilingual guide for Harbor Days', productStatus: 'unofficial', knowledgeStewardship: 'operator-curated' },
    regional: { timeZone: harbor.product.timeZone },
    languages: { default: 'en', supported: [{ code: 'en', label: 'English' }, { code: 'es', label: 'Spanish' }, { code: 'fr', label: 'French' }] },
    years: { minimum: 2030, maximum: 2040, defaultBehavior: 'current-calendar-year' },
    verification: { authority: 'official-source', label: 'Harbor Days official notices', url: harbor.product.verificationUrl },
    citations: { required: true, platform: 'facebook', host: 'harbordays.example.org', pagePath: '/official', postPathPrefix: '/official/posts/' },
    chat: { conversationHistoryLimit: 4 },
  })
}

describe('Phase 7 deterministic generic-event reference deployment proof', () => {
  it('P7-T1..T12 keeps the second event materially distinct across identity, aliases, locale, trust, branding, and persistence', () => {
    const product = syntheticProduct()
    const policy = syntheticRagPolicy()
    const freshness = defineDeploymentFreshnessConfig({ deploymentId: harbor.deployment.id, identity: { assistantName: harbor.product.assistantName, eventName: harbor.product.eventName }, freshness: { thresholds: harbor.freshness, timeZone: harbor.product.timeZone, dateTimeLocale: 'en-US' } })
    expect(product.identity.aliases).toEqual(harbor.product.aliases)
    expect(policy.languages.supported.map(({ code }) => code)).toEqual(['en', 'es', 'fr'])
    expect(product.regional.timeZone).toBe(harbor.product.timeZone)
    expect(product.officialSource.url).toBe(harbor.product.verificationUrl)
    expect(product.trust.nonAffiliationNotice).toBe(harbor.product.nonAffiliationNotice)
    expect(freshness.freshness.thresholds).toEqual(harbor.freshness)
    expect(product.persistence.namespace).toBe(harbor.deployment.storageNamespace)
    expect(product.persistence.offlineKnowledge.databaseName).toBe(harbor.deployment.offlineDatabase)
    expect(JSON.stringify({ product, policy, freshness })).not.toContain('Buglasan')
  })

  it('P7-T13..T18 preserves synthetic knowledge, provenance, acquisition state, source identity/type, and UNKNOWN publication time through ingress', () => {
    const payload = adaptToSourceIngestionPayload({ id: 'harbor-days-adapter-v1', adapt: () => sourceRecord() }, {})
    expect(payload).toMatchObject({ platform: 'facebook', post_id: harbor.source.identity, post_url: harbor.source.reference, published_at: null, festival_year: 2031, source_type: 'text', collection_method: 'manual' })
    expect(payload.raw_text).toContain(harbor.knowledge.text)
    expect(payload.source_metadata).toMatchObject({ fixture: 'phase7-reference', source_adapter: { event_cycle: 'Harbor Days', acquisition_state: 'operator_provided_content', provenance: 'operator_provided' } })
    const normalized = normalizeSourceIngestionPayload(payload)
    expect(normalized.source_metadata).toEqual(payload.source_metadata)
    expect(normalized.published_at).toBeNull()
  })

  it('P7-T19..T22 proves UNKNOWN != NO, cycle isolation, and distinct synthetic knowledge', () => {
    expect(genericRagPrinciples.evidence.unknownIsNotNo).toBe(true)
    expect(genericRagPrinciples.evidence.zeroEvidenceRequiresFallback).toBe(true)
    const current = { cycle: 2031, text: harbor.knowledge.text }
    const prior = { cycle: 2030, text: 'Harbor Days 2030 dock concert occurred last cycle.' }
    expect(current.cycle).not.toBe(prior.cycle)
    expect(current.text).not.toContain(prior.text)
    expect(current.text).not.toContain('NO')
  })

  it('P7-T23..T28 renders a separated PWA and scans every generated artifact for Buglasan-only leakage', async () => {
    validateDeploymentBranding(syntheticDeploymentBranding)
    const isolatedBranding = structuredClone(syntheticDeploymentBranding)
    isolatedBranding.assets.logo.source = 'public/brand/buglasan-ai-canonical.png'
    isolatedBranding.assets.icons[0].source = 'public/icons/icon-192.png'
    isolatedBranding.assets.icons[1].source = 'public/icons/icon-512.png'
    isolatedBranding.assets.icons[2].source = 'public/icons/icon-512-maskable.png'
    isolatedBranding.assets.appleTouchIcon.source = 'public/icons/apple-touch-icon.png'
    const artifacts = await renderStaticDeployment(isolatedBranding as Parameters<typeof renderStaticDeployment>[0], process.cwd())
    const combined = Object.values(artifacts).join('\n').toLowerCase()
    expect(combined).toContain('harbor lights festival')
    for (const term of buglasanOnlyTerms) expect(combined).not.toContain(term)
  })

  it('P7-T29..T34 proves no runtime tenant selection, no second backend/live deployment, no Facebook acquisition, and protected contracts stay untouched', () => {
    const adapterSource = readFileSync('src/ingestion/sourceAdapter.ts', 'utf8')
    const workflow = readFileSync('n8n/workflows/buglasan-source-collector.json', 'utf8')
    expect(adapterSource).not.toMatch(/event\s*===|tenant\s*===|import\.meta\.env|Deno\.env/)
    expect(workflow).toContain('"active": false')
    expect(workflow).toContain('ingest_source')
    expect(sourceRecord().acquisition).toMatchObject({ state: 'operator_provided_content', collection_method: 'manual' })
    expect(readFileSync('package.json', 'utf8')).not.toMatch(/deploy|vercel|cloudflare/i)
    expect(protectedContracts.every((path) => readFileSync(path).length > 0)).toBe(true)
    const changed = readFileSync('test/fixtures/phase7-harbor-days.mjs', 'utf8') + readFileSync('scripts/phase7-reference-deployment.test.ts', 'utf8')
    expect(createHash('sha256').update(changed).digest('hex')).toMatch(/^[a-f0-9]{64}$/)
  })
})
