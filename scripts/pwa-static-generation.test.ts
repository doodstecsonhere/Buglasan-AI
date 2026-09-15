import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deploymentBranding } from '../config/deployment-branding.mjs'
import { syntheticDeploymentBranding } from '../test/fixtures/pwa-synthetic-branding.mjs'
import { OUTPUTS, cacheName, cacheOwnershipPrefix, renderStaticDeployment, validateDeploymentAssets, validateDeploymentBranding, writeStaticDeployment } from '../build/pwa-static.mjs'

const root = process.cwd()
const temporaryDirectories: string[] = []
const clone = <T>(value: T): T => structuredClone(value)
const mutable = (value: unknown): Record<string, any> => value as Record<string, any>
let syntheticRoot: string

async function snapshot(paths: string[]) { return Object.fromEntries(await Promise.all(paths.map(async path => [path, await readFile(resolve(root, path))]))) }
async function expectSnapshot(snapshotValue: Record<string, Buffer>) { for (const [path, bytes] of Object.entries(snapshotValue)) expect(await readFile(resolve(root, path))).toEqual(bytes) }

type WorkerEvent = { waitUntil?: (promise: Promise<unknown>) => void; respondWith?: (promise: Promise<Response>) => void; [key: string]: unknown }
function generatedWorkerHarness(source: string) {
  const listeners = new Map<string, (event: WorkerEvent) => void>()
  const stores = new Map<string, Map<string, Response>>()
  const deleted: string[] = []; const fetched: string[] = []; let claimed = false; let skipped = false
  const keyOf = (request: RequestInfo | URL) => typeof request === 'string' ? request : request instanceof URL ? request.href : request.url
  const caches = {
    async keys() { return [...stores.keys()] },
    async delete(name: string) { deleted.push(name); return stores.delete(name) },
    async open(name: string) {
      const store = stores.get(name) ?? new Map<string, Response>(); stores.set(name, store)
      return {
        async addAll(urls: string[]) { for (const url of urls) store.set(url, new Response(`precache:${url}`, { status: 200 })) },
        async put(request: RequestInfo | URL, response: Response) { store.set(keyOf(request), response) },
        async match(request: RequestInfo | URL) { return store.get(keyOf(request)) },
      }
    },
  }
  const self = {
    location: { origin: 'https://app.example' }, clients: { async claim() { claimed = true } },
    skipWaiting() { skipped = true }, addEventListener(type: string, listener: (event: WorkerEvent) => void) { listeners.set(type, listener) },
  }
  const fetch = async (request: RequestInfo | URL) => { const url = keyOf(request); fetched.push(url); return new Response(`network:${url}`, { status: 200 }) }
  runInNewContext(source, { self, caches, fetch, URL, Response, Set, Promise })
  async function dispatch(type: string, values: Record<string, unknown> = {}) {
    let lifetime: Promise<unknown> | undefined; let response: Promise<Response> | undefined
    listeners.get(type)?.({ ...values, waitUntil(promise) { lifetime = promise }, respondWith(promise) { response = promise } })
    await lifetime
    return { intercepted: Boolean(response), response: response ? await response : undefined }
  }
  return { caches, claimed: () => claimed, deleted, dispatch, fetched, skipped: () => skipped, stores }
}

beforeAll(async () => {
  syntheticRoot = await mkdtemp(join(tmpdir(), 'pwa-synthetic-root-')); temporaryDirectories.push(syntheticRoot)
  await cp(resolve(root, 'templates'), resolve(syntheticRoot, 'templates'), { recursive: true })
  const copies = [
    ['public/favicon.svg', 'public/favicon.svg'], ['public/brand/buglasan-ai-canonical.png', 'public/brand/harbor-guide.png'],
    ['public/icons/icon-192.png', 'public/icons/harbor-192.png'], ['public/icons/icon-512.png', 'public/icons/harbor-512.png'],
    ['public/icons/icon-512-maskable.png', 'public/icons/harbor-maskable.png'], ['public/icons/apple-touch-icon.png', 'public/icons/harbor-apple.png'],
  ]
  for (const [source, target] of copies) { await cp(resolve(root, source), resolve(syntheticRoot, target), { recursive: false }) }
})
afterAll(async () => Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true }))))

describe('Phase 2 deployment branding and static generation', () => {
  it('P2-T1 validates exact production identity, official URL, assets, and derived cache contract', () => {
    expect(validateDeploymentBranding(deploymentBranding)).toBe(deploymentBranding)
    expect(deploymentBranding.product).toMatchObject({ eventName: 'Buglasan Festival', officialUrl: 'https://www.facebook.com/Buglasan', avatarPath: '/icons/icon-192.png' })
    expect(deploymentBranding.assets).toMatchObject({ favicon: { publicPath: '/favicon.svg' }, appleTouchIcon: { width: 180, height: 180 } })
    expect(deploymentBranding.assets.icons.map(icon => icon.purpose)).toEqual(['any', 'any', 'maskable'])
    expect(cacheOwnershipPrefix(deploymentBranding)).toBe('buglasan-ai.production.shell-')
    expect(cacheName(deploymentBranding)).toBe('buglasan-ai.production.shell-v5-offline-knowledge')
    const missing = clone(deploymentBranding); delete mutable(missing).offline
    expect(() => validateDeploymentBranding(missing)).toThrow('deploymentBranding.offline')
  })

  it('P2-T2 rejects unsafe paths, deployment/cache identity, colors, URLs, and duplicate categories', () => {
    const path = clone(deploymentBranding); mutable(path).assets.icons[0].source = '../secret.png'; expect(() => validateDeploymentBranding(path)).toThrow('source')
    const cache = clone(deploymentBranding); mutable(cache).deployment.id = 'Unsafe Cache'; expect(() => validateDeploymentBranding(cache)).toThrow('deployment.id')
    const color = clone(deploymentBranding); mutable(color).colors.theme = 'navy'; expect(() => validateDeploymentBranding(color)).toThrow('colors.theme')
    const url = clone(deploymentBranding); mutable(url).product.officialUrl = 'javascript:alert(1)'; expect(() => validateDeploymentBranding(url)).toThrow('officialUrl')
    const categories = clone(deploymentBranding); mutable(categories).pwa.categories = ['events', 'events']; expect(() => validateDeploymentBranding(categories)).toThrow('pwa.categories')
  })

  it('P2-T3 rejects arbitrary HTML, demo markers, and credential indicators by escaping all metadata', async () => {
    const config = clone(syntheticDeploymentBranding) as Parameters<typeof renderStaticDeployment>[0]; mutable(config).metadata.htmlDescription = '<script>alert(1)</script>'
    const html = (await renderStaticDeployment(config, syntheticRoot))['index.html']
    expect(html).not.toContain('<script>alert(1)</script>'); expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    const credential = clone(deploymentBranding); mutable(credential).offline.message = 'Bearer abcdefghijklmnop'
    expect(() => validateDeploymentBranding(credential)).toThrow('obvious credential indicators')
  })

  it('P2-T4 validates SVG safety and every raster existence, signature, and dimensions without fallback', async () => {
    await expect(validateDeploymentAssets(deploymentBranding, root)).resolves.toBeUndefined()
    const wrongSize = clone(syntheticDeploymentBranding) as Parameters<typeof validateDeploymentAssets>[0]; mutable(wrongSize).assets.logo.width = 1200
    await expect(validateDeploymentAssets(wrongSize, syntheticRoot)).rejects.toThrow('must be 1200x1254')
    const unsafeSvg = clone(syntheticDeploymentBranding) as Parameters<typeof validateDeploymentAssets>[0]; await writeFile(resolve(syntheticRoot, 'public/favicon.svg'), '<svg><script>alert(1)</script></svg>')
    await expect(validateDeploymentAssets(unsafeSvg, syntheticRoot)).rejects.toThrow('safe standalone SVG')
    await cp(resolve(root, 'public/favicon.svg'), resolve(syntheticRoot, 'public/favicon.svg'))
  })

  it('P2-T5 renders deterministic production artifacts without relying on checked-in generated outputs', async () => {
    const first = await renderStaticDeployment(deploymentBranding, root); const second = await renderStaticDeployment(deploymentBranding, root)
    expect(second).toEqual(first); expect(Object.keys(first).sort()).toEqual(Object.keys(OUTPUTS).sort())
  })

  it('P2-T6/T7 rendered synthetic artifacts use only their declared static identity fields with zero production leakage', async () => {
    const rendered = await renderStaticDeployment(syntheticDeploymentBranding as Parameters<typeof renderStaticDeployment>[0], syntheticRoot); const combined = Object.values(rendered).join('\n')
    const html = rendered['index.html']; const manifest = JSON.parse(rendered['manifest.webmanifest'])
    expect(html).toContain('<title>Harbor Guide</title>'); expect(html).toContain('content="Harbor Lights Festival"'); expect(html).toContain('https://www.facebook.com/HarborLightsOfficial')
    expect(html).toContain('href="/favicon.svg"'); expect(html).toContain('href="/icons/harbor-apple.png"'); expect(html).toContain('content="/brand/harbor-guide.png"'); expect(html).toContain('content="#123456"')
    expect(manifest).toMatchObject({ name: 'Harbor Guide', short_name: 'Harbor PWA', description: 'A multilingual guide for the synthetic Harbor Lights Festival', theme_color: '#123456' })
    expect(manifest.icons.map((icon: { src: string }) => icon.src)).toEqual(['/icons/harbor-192.png', '/icons/harbor-512.png', '/icons/harbor-maskable.png'])
    expect(combined.toLowerCase()).not.toContain('buglasan')
  })

  it('keeps the production manifest short-name contract exactly Buglasan AI', async () => {
    const manifest = JSON.parse((await renderStaticDeployment(deploymentBranding, root))['manifest.webmanifest'])
    expect(deploymentBranding.pwa.shortName).toBe('Buglasan AI')
    expect(manifest.short_name).toBe('Buglasan AI')
  })

  it('P2-T8/T9 generates escaped offline identity and deployment/storage-derived cache namespace', async () => {
    const rendered = await renderStaticDeployment(syntheticDeploymentBranding as Parameters<typeof renderStaticDeployment>[0], syntheticRoot)
    expect(rendered['offline.html']).toContain('Harbor Guide is offline'); expect(rendered['offline.html']).toContain('Harbor Lights Festival')
    expect(rendered['service-worker.js']).toContain('harbor-guide.staging-blue.shell-v1')
    expect(rendered['service-worker.js']).toContain('/brand/harbor-guide.png')
  })

  it('P2-T10 executes the generated install and activate lifecycle with scoped cache ownership', async () => {
    const worker = (await renderStaticDeployment(syntheticDeploymentBranding as Parameters<typeof renderStaticDeployment>[0], syntheticRoot))['service-worker.js']; const harness = generatedWorkerHarness(worker)
    harness.stores.set('third-party.cache-v1', new Map()); harness.stores.set('harbor-guide.other-deployment.shell-v1', new Map())
    harness.stores.set('harbor-guide.staging-blue.shell-v0', new Map()); harness.stores.set('harbor-guide.staging-blue.shell-v1', new Map())
    await harness.dispatch('install'); expect(harness.skipped()).toBe(true)
    expect(harness.stores.get('harbor-guide.staging-blue.shell-v1')?.has('/index.html')).toBe(true)
    await harness.dispatch('activate'); expect(harness.claimed()).toBe(true)
    expect(harness.deleted).toEqual(['harbor-guide.staging-blue.shell-v0'])
    expect([...harness.stores.keys()]).toEqual(expect.arrayContaining(['third-party.cache-v1', 'harbor-guide.other-deployment.shell-v1', 'harbor-guide.staging-blue.shell-v1']))
  })

  it('executes generated fetch/message behavior without intercepting or caching API, chat, Edge Function, or query/hash assets', async () => {
    const worker = (await renderStaticDeployment(syntheticDeploymentBranding as Parameters<typeof renderStaticDeployment>[0], syntheticRoot))['service-worker.js']; const harness = generatedWorkerHarness(worker)
    const excluded = ['/api/events', '/chat', '/functions/v1/chat', '/assets/app.js?v=2', '/assets/app.css#theme']
    for (const path of excluded) {
      const result = await harness.dispatch('fetch', { request: new Request(`https://app.example${path}`, { method: 'GET' }) })
      expect(result.intercepted, path).toBe(false)
    }
    await harness.dispatch('message', { data: { type: 'PRECACHE_APP_SHELL', urls: [...excluded, '/assets/app.js', 'https://edge.example/functions/v1/chat'] } })
    expect(harness.fetched).toEqual(['https://app.example/assets/app.js'])
    const runtime = harness.stores.get('harbor-guide.staging-blue.shell-v1')
    expect(runtime?.has('https://app.example/assets/app.js')).toBe(true)
    for (const path of excluded) expect(runtime?.has(`https://app.example${path}`), path).not.toBe(true)
    const asset = await harness.dispatch('fetch', { request: new Request('https://app.example/assets/new.css', { method: 'GET' }) })
    expect(asset.intercepted).toBe(true); expect(await asset.response?.text()).toBe('network:https://app.example/assets/new.css')
  })

  it('P2-T11 generation writes only to an explicit isolated build target and never mutates source/templates', async () => {
    const protectedPaths = ['index.html', 'templates/pwa/index.html', 'templates/pwa/offline.html', 'templates/pwa/service-worker.js.template', 'public/manifest.webmanifest', 'public/offline.html', 'public/service-worker.js']
    const before = await snapshot(protectedPaths); const target = await mkdtemp(join(tmpdir(), 'pwa-output-')); temporaryDirectories.push(target)
    await expect(writeStaticDeployment(syntheticDeploymentBranding as Parameters<typeof writeStaticDeployment>[0], syntheticRoot, target)).resolves.toBeDefined()
    expect((await readdir(target)).sort()).toEqual(Object.values(OUTPUTS).sort()); await expectSnapshot(before)
    await expect(writeStaticDeployment(deploymentBranding, root, '')).rejects.toThrow('targetRoot is required')
  })

  it('P2-T12 materialization leaves no tracked source residue and output is complete', async () => {
    const protectedPaths = ['index.html', 'public/manifest.webmanifest', 'public/offline.html', 'public/service-worker.js']; const before = await snapshot(protectedPaths)
    const target = await mkdtemp(join(tmpdir(), 'pwa-dist-')); temporaryDirectories.push(target); const rendered = await writeStaticDeployment(deploymentBranding, root, target)
    for (const [name, path] of Object.entries(OUTPUTS)) expect(await readFile(resolve(target, path), 'utf8')).toBe(rendered[name])
    await expectSnapshot(before)
  })
})
