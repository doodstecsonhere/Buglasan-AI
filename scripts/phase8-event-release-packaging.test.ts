import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deploymentBranding } from '../config/deployment-branding.mjs'
import { defineEventReleasePackage, eventReleasePackage, eventReleasePackageDefinitions, selectEventReleasePackage, selectProductionEventReleasePackage } from '../config/release-package.mjs'
import { PACKAGE_FILE, REQUIRED_ARTIFACTS, inspectEventRelease, renderEventReleaseManifest, writeEventReleasePackage } from './package-event-release.mjs'
import { harborDaysReferenceDeployment } from '../test/fixtures/phase7-harbor-days.mjs'
import { harborReferenceReleasePackage } from '../test/fixtures/phase8-harbor-release-package.mjs'

async function releaseDirectory() {
  const root = await mkdtemp(join(tmpdir(), 'phase8-release-'))
  await mkdir(join(root, 'assets'), { recursive: true })
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Buglasan AI</title><script src="/assets/app.js"></script>')
  await writeFile(join(root, 'manifest.webmanifest'), '{"name":"Buglasan AI"}\n')
  await writeFile(join(root, 'offline.html'), '<title>Buglasan AI is offline</title>')
  await writeFile(join(root, 'service-worker.js'), 'self.addEventListener("install", () => {})')
  await writeFile(join(root, 'assets', 'app.js'), 'console.log("Buglasan AI")')
  return root
}

describe('Phase 8 independent event release packaging', () => {
  it('P8-T1 declares the v1 package schema', () => expect(eventReleasePackage.schemaVersion).toBe('event-release-package/v1'))
  it('P8-T2 fixes the production target as Buglasan', () => expect(eventReleasePackage.targetId).toBe('buglasan-production'))
  it('P8-T3 declares the production deployment class', () => expect(eventReleasePackage.deploymentClass).toBe('production'))
  it('P8-T4 preserves the Buglasan package identity', () => expect(eventReleasePackage.packageId).toBe('buglasan-ai'))
  it('P8-T5 preserves the dist output directory', () => expect(eventReleasePackage.outputDirectory).toBe('dist'))
  it('P8-T6 preserves HTTPS root SPA hosting', () => expect(eventReleasePackage.hosting).toEqual({ protocol: 'https', historyFallback: '/index.html', entrypoint: '/index.html' }))
  it('P8-T7 retains the existing branded product identity', () => expect(eventReleasePackage.product).toEqual({ assistantName: deploymentBranding.product.assistantName, eventName: deploymentBranding.product.eventName, officialUrl: deploymentBranding.product.officialUrl }))
  it('P8-T8 retains the canonical branding object', () => expect(eventReleasePackage.branding).toBe(deploymentBranding))
  it('P8-T9 exposes no sensitive or acquisition material', () => expect(JSON.stringify(eventReleasePackage)).not.toMatch(/secret|token|key|tenant|facebook acquisition/i))
  it('P8-T10 selects the immutable production package without environment selection', () => expect(selectProductionEventReleasePackage()).toEqual(eventReleasePackage))
  it('P8-T11 selects Buglasan when its target is explicitly named', () => expect(selectEventReleasePackage(eventReleasePackageDefinitions, 'buglasan-production')).toEqual(eventReleasePackage))
  it('P8-T12 rejects a missing explicit generic target', () => expect(() => selectEventReleasePackage(eventReleasePackageDefinitions, undefined as unknown as string)).toThrow('explicitly name'))
  it('P8-T13 rejects an unknown target', () => expect(() => selectEventReleasePackage(eventReleasePackageDefinitions, 'unknown')).toThrow('does not name'))
  it('P8-T14 rejects unsafe output directories', () => expect(() => defineEventReleasePackage({ ...eventReleasePackage, outputDirectory: '../dist' })).toThrow('outputDirectory'))
  it('P8-T15 rejects product/branding mismatches', () => expect(() => defineEventReleasePackage({ ...eventReleasePackage, product: { ...eventReleasePackage.product, eventName: 'Mismatch' } })).toThrow('must match'))
  it('P8-T16 identifies Harbor as the Phase 7 reference deployment', () => expect(harborDaysReferenceDeployment.deployment.id).toBe('harbor-days-reference'))
  it('P8-T17 keeps Harbor acquisition operator-provided and manual', () => expect(harborDaysReferenceDeployment.source.acquisition).toMatchObject({ state: 'operator_provided_content', collectionMethod: 'manual' }))
  it('P8-T18 declares Harbor as reference-only', () => expect(harborReferenceReleasePackage.deploymentClass).toBe('reference-only'))
  it('P8-T19 refuses Harbor generic selection without explicit reference opt-in', () => expect(() => selectEventReleasePackage([eventReleasePackage, harborReferenceReleasePackage], 'harbor-reference')).toThrow('reference-only'))
  it('P8-T20 selects Harbor only with explicit reference opt-in', () => expect(selectEventReleasePackage([eventReleasePackage, harborReferenceReleasePackage], 'harbor-reference', { allowReference: true })).toEqual(harborReferenceReleasePackage))
  it('P8-T21 excludes Harbor from production definitions', () => expect(eventReleasePackageDefinitions).not.toContain(harborReferenceReleasePackage))
  it('P8-T22 excludes Harbor from the production package contract', () => expect(JSON.stringify(eventReleasePackage)).not.toContain('Harbor'))
  it('P8-T23 excludes Harbor verification URLs from the production package contract', () => expect(JSON.stringify(eventReleasePackage)).not.toContain(harborDaysReferenceDeployment.product.verificationUrl))
  it('P8-T24 validates every required static-shell artifact', async () => { const root = await releaseDirectory(); try { expect((await inspectEventRelease(root)).map(file => file.path)).toEqual(['assets/app.js', ...REQUIRED_ARTIFACTS]) } finally { await rm(root, { recursive: true, force: true }) } })
  it('P8-T25 rejects a stale integrity manifest', async () => { const root = await releaseDirectory(); try { await writeFile(join(root, PACKAGE_FILE), '{}\n'); await expect(inspectEventRelease(root)).rejects.toThrow('does not match') } finally { await rm(root, { recursive: true, force: true }) } })
  it('P8-T26 produces deterministic manifest content', async () => { const root = await releaseDirectory(); try { const first = renderEventReleaseManifest(await inspectEventRelease(root)); expect(renderEventReleaseManifest(await inspectEventRelease(root))).toBe(first) } finally { await rm(root, { recursive: true, force: true }) } })
  it('P8-T27 orders manifest paths lexically', async () => { const root = await releaseDirectory(); try { const manifest = JSON.parse(renderEventReleaseManifest(await inspectEventRelease(root))); expect(manifest.files).toEqual([...manifest.files].sort((left, right) => left.path.localeCompare(right.path))) } finally { await rm(root, { recursive: true, force: true }) } })
  it('P8-T28 omits time and environment input from the manifest', async () => { const root = await releaseDirectory(); try { expect(renderEventReleaseManifest(await inspectEventRelease(root))).not.toMatch(/created|date|\.env|process\.env/i) } finally { await rm(root, { recursive: true, force: true }) } })
  it('P8-T29 writes the integrity manifest to the package directory', async () => { const root = await releaseDirectory(); try { expect((await writeEventReleasePackage(root)).target).toBe(join(root, PACKAGE_FILE)) } finally { await rm(root, { recursive: true, force: true }) } })
  it('P8-T30 writes the selected generic reference package identity only after package opt-in', async () => { const root = await releaseDirectory(); try { const reference = selectEventReleasePackage([eventReleasePackage, harborReferenceReleasePackage], 'harbor-reference', { allowReference: true }); await expect(writeEventReleasePackage(root, { releasePackage: reference })).rejects.toThrow('reference opt-in'); await writeEventReleasePackage(root, { releasePackage: reference, allowReference: true }); expect(JSON.parse(await readFile(join(root, PACKAGE_FILE), 'utf8')).package.id).toBe('harbor-guide-reference') } finally { await rm(root, { recursive: true, force: true }) } })
  it('P8-T31 rewrites a stale manifest after valid artifacts are rebuilt', async () => { const root = await releaseDirectory(); try { await writeFile(join(root, PACKAGE_FILE), '{}\n'); await expect(writeEventReleasePackage(root)).resolves.toMatchObject({ target: join(root, PACKAGE_FILE) }) } finally { await rm(root, { recursive: true, force: true }) } })
  it('P8-T32 rejects source maps', async () => { const root = await releaseDirectory(); try { await writeFile(join(root, 'assets', 'app.js.map'), '{}'); await expect(inspectEventRelease(root)).rejects.toThrow('source maps') } finally { await rm(root, { recursive: true, force: true }) } })
  it('P8-T33 rejects credential-shaped artifact bytes', async () => { const root = await releaseDirectory(); try { await writeFile(join(root, 'assets', 'app.js'), 'api_key=abcdefghijklmnopqrstuvwxyz'); await expect(inspectEventRelease(root)).rejects.toThrow('credential material') } finally { await rm(root, { recursive: true, force: true }) } })
  it('P8-T34 rejects unvalidated generic package input', () => expect(() => renderEventReleaseManifest([{ path: 'index.html', bytes: 1, sha256: 'x' }], { packageId: 'invalid' })).toThrow('schemaVersion'))
})
