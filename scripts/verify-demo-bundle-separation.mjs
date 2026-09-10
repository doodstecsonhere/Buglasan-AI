import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const outputRoot = '.tmp-demo-bundle-verification'
const liveOutput = join(outputRoot, 'live')
const demoOutput = join(outputRoot, 'demo')
const fixtureMarkers = ['[DEMO FIXTURE]', 'demo_current_schedule_001', 'Demo Dish A']

function build(outputDir, demoMode) {
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', outputDir], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEMO_MODE: demoMode },
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
  for (const marker of fixtureMarkers) {
    if (liveBundle.includes(marker)) throw new Error(`Live build leaked demo fixture marker: ${marker}`)
  }
  if (existsSync(join(liveOutput, 'assets', 'demoData.js'))) {
    throw new Error('Live build emitted a demo data chunk')
  }

  build(demoOutput, 'true')
  const demoBundle = bundleText(demoOutput)
  if (!demoBundle.includes(fixtureMarkers[0])) {
    throw new Error('Explicit demo build did not include its fixture marker')
  }

  console.log('Verified: live build excludes demo fixtures; explicit demo build retains them.')
} finally {
  rmSync(outputRoot, { recursive: true, force: true })
}
