import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PUBLIC_CHAT_ENDPOINT } from './public-chat-release-config.mjs'

const outputRoot = '.tmp-demo-bundle-verification'
const liveOutput = join(outputRoot, 'live')
const demoOutput = join(outputRoot, 'demo')
const prohibitedLiveMarkers = [
  'BUGLASAN AI (DEMO)',
  '[DEMO FIXTURE]',
  'demo_current_schedule_001',
  'Demo Dish A',
  'No demo information found',
  'No demo information matches that query',
  'Demo fixtures only. Real ingestion will replace this data.',
  'derived from demo sources',
]

function build(outputDir, demoMode) {
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', outputDir], {
    stdio: 'inherit',
    // Fixture-separation verification uses the same public-only configuration
    // required for a release; this is not a credential and never reaches tests.
    env: { ...process.env, VITE_DEMO_MODE: demoMode, VITE_CHAT_ENDPOINT: PUBLIC_CHAT_ENDPOINT, VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'build-verification-public-key' },
  })
}

function filesRecursively(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name)
    return entry.isDirectory() ? filesRecursively(entryPath) : [entryPath]
  })
}

function bundleText(path) {
  return filesRecursively(path)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
}

rmSync(outputRoot, { recursive: true, force: true })
mkdirSync(outputRoot, { recursive: true })

try {
  build(liveOutput, 'false')
  const liveBundle = bundleText(liveOutput)
  for (const marker of prohibitedLiveMarkers) {
    if (liveBundle.includes(marker)) throw new Error(`Live build leaked demo fixture marker: ${marker}`)
  }
  if (existsSync(join(liveOutput, 'assets', 'demoData.js'))) {
    throw new Error('Live build emitted a demo data chunk')
  }

  build(demoOutput, 'true')
  const demoBundle = bundleText(demoOutput)
  if (!demoBundle.includes('[DEMO FIXTURE]')) {
    throw new Error('Explicit demo build did not include its fixture marker')
  }

  console.log('Verified: live build excludes demo fixtures; explicit demo build retains them.')
} finally {
  rmSync(outputRoot, { recursive: true, force: true })
}
