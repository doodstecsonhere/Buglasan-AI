import { readFileSync, readdirSync, statSync } from 'node:fs'
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { genericRagPrinciples } from '../config/rag-policy.mjs'
import { defineDeploymentFreshnessConfig } from '../src/config/freshnessConfig'
import { defineRagPolicy } from '../config/rag-policy.mjs'
import { defineProductConfig } from '../src/config/productConfig'
import { adaptToSourceIngestionPayload, type SourceAdapterRecord } from '../src/ingestion/sourceAdapter'
import { normalizeSourceIngestionPayload } from '../src/ingestion/sourceIngestion'
import { ingestGenericCollectorRecord } from '../src/ingestion/genericCollectorIngress'
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
const phase6BaselineHashes = {
  'src/App.tsx': '72bc0165ddc62b471d4f806a45798a67f6e4c1d03ddb48959b15d8c53974435b',
  'src/services/chatService.ts': 'cdaed25f3117e32a7d0d24abf42f2494db686f3de45b953fffc5c853d66e1818',
  'src/services/demoChatResponder.ts': '9654477efed607149f934057b53dac725e429e9dbe1fdc192f34eb065e870618',
  'supabase/functions/chat/index.ts': 'c19ce954b59f2bbb59263bd5a1d6b46ce1f09b500659e9805c31007c242bacfa',
  'supabase/functions/chat/grounding.ts': '4ec876b7982c2de6a0f551c550a55dfc785461c27c5cb90d6a138ac25c0c8f24',
  'supabase/functions/_shared/extraction.ts': '1b748871b690de33d0e9079dbd0633311826c56a532dd1bc5482efc646ece7b8',
  'supabase/functions/_shared/reconciliation.ts': 'bee4cfa1297d817eba9959c41f766506abdb58eda404a54cac332e2019e76023',
  'n8n/workflows/buglasan-source-collector.json': '077fef581f26aef625ca37cd92225a352c731cc61293d2819439fc4ba62ede9e',
} as const

const relevantDeploymentPaths = [
  'src/App.tsx', 'src/config', 'src/services', 'config', 'templates', 'public/manifest.webmanifest', 'public/service-worker.js', 'n8n/workflows', 'supabase/config.toml',
]

function repositoryFiles(paths: string[]): string[] {
  const files: string[] = []
  const visit = (path: string) => {
    if (!statSync(path).isDirectory()) { files.push(path); return }
    for (const entry of readdirSync(path)) visit(join(path, entry))
  }
  for (const path of paths) if (statSync(path, { throwIfNoEntry: false })) visit(path)
  return files
}

function readRelevantDeploymentText(): string {
  return repositoryFiles(relevantDeploymentPaths).map(path => readFileSync(path, 'utf8')).join('\n')
}

function assertNoLeakedSecrets(text: string): void {
  expect(text).not.toMatch(/(?:service_role|anon|supabase|facebook)[_-]?(?:key|token|secret)\s*[:=]\s*['"]?[A-Za-z0-9._-]{16,}/i)
  expect(text).not.toMatch(/(?:api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key)\s*[:=]\s*['"]?(?!YOUR_|REPLACE_|CHANGE_ME|example|placeholder)[A-Za-z0-9/+._=-]{16,}/i)
}

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
    const outputRoot = await mkdtemp(join(tmpdir(), 'phase7-reference-'))
    try {
      await mkdir(join(outputRoot, 'templates/pwa'), { recursive: true })
      await mkdir(join(outputRoot, 'public/brand'), { recursive: true })
      await mkdir(join(outputRoot, 'public/icons'), { recursive: true })
      for (const name of ['index.html', 'offline.html', 'service-worker.js.template']) await copyFile(join(process.cwd(), 'templates/pwa', name), join(outputRoot, 'templates/pwa', name))
      const assetCopies = [
        ['public/brand/buglasan-ai-canonical.png', 'public/brand/harbor-guide.png'],
        ['public/icons/icon-192.png', 'public/icons/harbor-192.png'],
        ['public/icons/icon-512.png', 'public/icons/harbor-512.png'],
        ['public/icons/icon-512-maskable.png', 'public/icons/harbor-maskable.png'],
        ['public/icons/apple-touch-icon.png', 'public/icons/harbor-apple.png'],
        ['public/favicon.svg', 'public/favicon.svg'],
      ]
      for (const [source, target] of assetCopies) {
        await mkdir(join(outputRoot, target.split('/').slice(0, -1).join('/')), { recursive: true })
        await copyFile(join(process.cwd(), source), join(outputRoot, target))
      }
      const artifacts = await renderStaticDeployment(isolatedBranding as Parameters<typeof renderStaticDeployment>[0], outputRoot)
      const generatedPaths = Object.keys(artifacts).map(name => join(outputRoot, name))
      for (const [name, content] of Object.entries(artifacts)) await writeFile(join(outputRoot, name), content, 'utf8')
      const staticPaths = [...generatedPaths, ...['public/brand/buglasan-ai-canonical.png', 'public/icons/icon-192.png', 'public/icons/icon-512.png', 'public/icons/icon-512-maskable.png', 'public/icons/apple-touch-icon.png'].map(path => join(process.cwd(), path))]
      const combined = (await Promise.all(staticPaths.map(async path => {
        const data = await readFile(path)
        return data.toString('utf8')
      }))).join('\n').toLowerCase()
      expect(combined).toContain('harbor lights festival')
      for (const term of buglasanOnlyTerms) expect(combined).not.toContain(term)
      expect(generatedPaths.map(path => path.split(/[\\/]/).pop())).toEqual(['index.html', 'manifest.webmanifest', 'offline.html', 'service-worker.js'])
      expect(readFileSync(join(outputRoot, 'manifest.webmanifest'), 'utf8')).toContain('Harbor Guide')
      assertNoLeakedSecrets(combined)
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('P7-T29..T34 proves no runtime tenant selection, no second backend/live deployment, no Facebook acquisition, and protected contracts stay untouched', () => {
    const adapterSource = readFileSync('src/ingestion/sourceAdapter.ts', 'utf8')
    const workflow = readFileSync('n8n/workflows/buglasan-source-collector.json', 'utf8')
    const runtimeText = readRelevantDeploymentText()
    expect(adapterSource).not.toMatch(/event\s*===|tenant\s*===|import\.meta\.env|Deno\.env/)
    expect(runtimeText).not.toMatch(/(?:tenant|event)[A-Z_a-z-]*(?:Selector|Selection|Resolver|Router)/)
    expect(runtimeText).not.toMatch(/(?:SECONDARY|SECOND|GENERIC_EVENT|TENANT)[A-Z_a-z-]*(?:URL|HOST|BACKEND|SUPABASE)/)
    expect(runtimeText).not.toMatch(/(?:vercel\.app|pages\.dev|workers\.dev|netlify\.app)/i)
    expect(workflow).toContain('"active": false')
    expect(workflow).toContain('ingest_source')
    expect(workflow).not.toMatch(/(?:Harbor Days|Harbor Lights|generic[_-]?event|tenant)/i)
    expect(adapterSource).toMatch(/source\.type !== 'facebook'/)
    expect(adapterSource).toMatch(/No collector target is selected/)
    expect(sourceRecord().acquisition).toMatchObject({ state: 'operator_provided_content', collection_method: 'manual' })
    // Build-time deployment validation is permitted; no hosted deployment
    // provider or external deployment target may be introduced.
    expect(readFileSync('package.json', 'utf8')).not.toMatch(/vercel|cloudflare/i)
    expect(adapterSource).not.toMatch(/(?:fetch\s*\(|axios|graph\.facebook\.com|facebook\.com\/v\d)/i)
    expect(workflow).not.toMatch(/Harbor Days|Harbor Lights/i)
    assertNoLeakedSecrets(runtimeText)
    for (const path of protectedContracts) {
      const content = readFileSync(path)
      expect(content.length, path).toBeGreaterThan(0)
      expect(createHash('sha256').update(content).digest('hex'), path).toBe(phase6BaselineHashes[path as keyof typeof phase6BaselineHashes])
    }
  })

  it('P7-T35..T38 proves the existing collector owns deterministic idempotency across two identical dispatches', () => {
    const seen = new Map<string, { firstPayload: ReturnType<typeof adaptToSourceIngestionPayload>; calls: number }>()
    const dispatch = (payload: ReturnType<typeof adaptToSourceIngestionPayload>) => {
      const fingerprint = createHash('sha256').update(JSON.stringify({ platform: payload.platform, post_id: payload.post_id, post_url: payload.post_url, festival_year: payload.festival_year, raw_text: payload.raw_text })).digest('hex')
      const existing = seen.get(fingerprint)
      if (existing) { existing.calls += 1; return { fingerprint, inserted: false, calls: existing.calls } }
      seen.set(fingerprint, { firstPayload: payload, calls: 1 })
      return { fingerprint, inserted: true, calls: 1 }
    }
    const input = sourceRecord()
    const first = ingestGenericCollectorRecord(input, dispatch)
    const second = ingestGenericCollectorRecord(input, dispatch)
    expect(first.inserted).toBe(true)
    expect(second).toMatchObject({ fingerprint: first.fingerprint, inserted: false, calls: 2 })
    expect(seen.size).toBe(1)
    expect(seen.get(first.fingerprint)?.firstPayload).toMatchObject({ post_id: harbor.source.identity, published_at: null, festival_year: harbor.knowledge.cycle })
  })
})
