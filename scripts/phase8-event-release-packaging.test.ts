import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deploymentBranding } from '../config/deployment-branding.mjs'
import { eventReleasePackage } from '../config/release-package.mjs'
import { PACKAGE_FILE, REQUIRED_ARTIFACTS, inspectEventRelease, renderEventReleaseManifest, writeEventReleasePackage } from './package-event-release.mjs'
import { harborDaysReferenceDeployment } from '../test/fixtures/phase7-harbor-days.mjs'

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
  it('P8-T1..T7 fixes one Buglasan-only, static-hosted build-time package contract', () => {
    expect(eventReleasePackage).toMatchObject({ schemaVersion: 'event-release-package/v1', packageId: 'buglasan-ai', outputDirectory: 'dist', hosting: { protocol: 'https', historyFallback: '/index.html' } })
    expect(eventReleasePackage.product).toEqual({ assistantName: deploymentBranding.product.assistantName, eventName: 'Buglasan Festival', officialUrl: deploymentBranding.product.officialUrl })
    expect(JSON.stringify(eventReleasePackage)).not.toMatch(/secret|token|key|tenant|facebook acquisition/i)
  })

  it('P8-T8..T14 treats Harbor Days exclusively as a synthetic/reference fixture, never a releasable product', () => {
    expect(harborDaysReferenceDeployment.deployment.id).toBe('harbor-days-reference')
    expect(harborDaysReferenceDeployment.source.acquisition).toMatchObject({ state: 'operator_provided_content', collectionMethod: 'manual' })
    expect(JSON.stringify(eventReleasePackage)).not.toContain('Harbor')
    expect(JSON.stringify(eventReleasePackage)).not.toContain(harborDaysReferenceDeployment.product.verificationUrl)
  })

  it('P8-T15..T21 validates the complete static shell and rejects a stale integrity manifest', async () => {
    const root = await releaseDirectory()
    try {
      const files = await inspectEventRelease(root)
      expect(files.map(file => file.path)).toEqual(['assets/app.js', ...REQUIRED_ARTIFACTS])
      await writeFile(join(root, PACKAGE_FILE), '{}\n')
      await expect(inspectEventRelease(root)).rejects.toThrow('does not match')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('P8-T22..T27 produces deterministic path-ordered integrity metadata without time or environment input', async () => {
    const root = await releaseDirectory()
    try {
      const files = await inspectEventRelease(root)
      const first = renderEventReleaseManifest(files)
      const second = renderEventReleaseManifest(await inspectEventRelease(root))
      expect(second).toBe(first)
      const manifest = JSON.parse(first)
      expect(manifest.files).toEqual([...manifest.files].sort((left, right) => left.path.localeCompare(right.path)))
      expect(first).not.toMatch(/created|date|\.env|process\.env/i)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('P8-T28..T34 writes only a checked release manifest and fails closed for missing artifacts, maps, and credential-shaped bytes', async () => {
    const root = await releaseDirectory()
    try {
      const result = await writeEventReleasePackage(root)
      expect(result.target).toBe(join(root, PACKAGE_FILE))
      expect(JSON.parse(await readFile(result.target, 'utf8')).package.eventName).toBe('Buglasan Festival')
      await rm(join(root, PACKAGE_FILE))
      await writeFile(join(root, 'assets', 'app.js.map'), '{}')
      await expect(inspectEventRelease(root)).rejects.toThrow('source maps')
      await rm(join(root, 'assets', 'app.js.map'))
      await writeFile(join(root, 'assets', 'app.js'), 'api_key=abcdefghijklmnopqrstuvwxyz')
      await expect(inspectEventRelease(root)).rejects.toThrow('credential material')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
