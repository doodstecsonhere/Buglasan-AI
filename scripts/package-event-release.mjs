import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { defineEventReleasePackage, selectProductionEventReleasePackage } from '../config/release-package.mjs'

const eventReleasePackage = selectProductionEventReleasePackage()

const REQUIRED_ARTIFACTS = Object.freeze(['index.html', 'manifest.webmanifest', 'offline.html', 'service-worker.js'])
const PACKAGE_FILE = 'event-release-package.json'
const SECRET_PATTERN = /(?:service[_-]?role|api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key|password)\s*[:=]\s*['"]?(?!YOUR_|REPLACE_|CHANGE_ME|example|placeholder)[A-Za-z0-9/+._=-]{16,}/i

function fail(message) { throw new Error(`Invalid event release package: ${message}`) }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function validatedPackage(releasePackage, allowReference) {
  const selected = defineEventReleasePackage(releasePackage)
  if (selected.deploymentClass === 'reference-only' && !allowReference) fail(`reference-only target ${selected.targetId} requires explicit reference opt-in`)
  return selected
}

async function filesBelow(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await filesBelow(root, path))
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join('/'))
  }
  return files.sort()
}

export async function inspectEventRelease(outputDirectory = eventReleasePackage.outputDirectory, { verifyManifest = true, releasePackage = eventReleasePackage, allowReference = false } = {}) {
  const validatedReleasePackage = validatedPackage(releasePackage, allowReference)
  const root = resolve(outputDirectory)
  let info
  try { info = await stat(root) } catch { fail(`output directory ${outputDirectory} does not exist; run the build first`) }
  if (!info.isDirectory()) fail(`output directory ${outputDirectory} must be a directory`)

  const allPaths = await filesBelow(root)
  const paths = allPaths.filter(path => path !== PACKAGE_FILE)
  for (const required of REQUIRED_ARTIFACTS) if (!paths.includes(required)) fail(`missing required artifact ${required}`)
  if (paths.some(path => path.endsWith('.map'))) fail('source maps are not permitted in a releasable package')

  const files = []
  for (const path of paths) {
    const bytes = await readFile(resolve(root, path))
    if (SECRET_PATTERN.test(bytes.toString('utf8'))) fail(`possible credential material in ${path}`)
    files.push(Object.freeze({ path, bytes: bytes.length, sha256: sha256(bytes) }))
  }
  const manifestPath = resolve(root, PACKAGE_FILE)
  if (verifyManifest && allPaths.includes(PACKAGE_FILE)) {
    let actual
    try { actual = await readFile(manifestPath, 'utf8') } catch { fail(`cannot read ${PACKAGE_FILE}`) }
    if (actual !== renderEventReleaseManifest(files, validatedReleasePackage)) fail(`${PACKAGE_FILE} does not match the current artifact set`)
  }
  return Object.freeze(files)
}

export function renderEventReleaseManifest(files, releasePackage = eventReleasePackage, { allowReference = false } = {}) {
  if (!Array.isArray(files) || !files.length) fail('package must contain at least one artifact')
  const validatedReleasePackage = validatedPackage(releasePackage, allowReference)
  return `${JSON.stringify({
    schemaVersion: validatedReleasePackage.schemaVersion,
    package: {
      id: validatedReleasePackage.packageId,
      assistantName: validatedReleasePackage.product.assistantName,
      eventName: validatedReleasePackage.product.eventName,
      officialUrl: validatedReleasePackage.product.officialUrl,
      hosting: validatedReleasePackage.hosting,
    },
    files,
  }, null, 2)}\n`
}

export async function writeEventReleasePackage(outputDirectory = eventReleasePackage.outputDirectory, { releasePackage = eventReleasePackage, allowReference = false } = {}) {
  // A prior manifest is an output, not an input: rebuild it from the current
  // artifact set so a legitimate rebuild can replace stale integrity metadata.
  const validatedReleasePackage = validatedPackage(releasePackage, allowReference)
  const files = await inspectEventRelease(outputDirectory, { verifyManifest: false, releasePackage: validatedReleasePackage, allowReference })
  const target = resolve(outputDirectory, PACKAGE_FILE)
  const manifest = renderEventReleaseManifest(files, validatedReleasePackage, { allowReference })
  await writeFile(target, manifest, 'utf8')
  return { target, manifest, files }
}

async function main() {
  const [command = '--validate', outputDirectory = eventReleasePackage.outputDirectory, ...options] = process.argv.slice(2)
  if (!['--validate', '--write'].includes(command) || options.length) fail('usage: package-event-release.mjs [--validate|--write] [output-directory]')
  if (command === '--validate') {
    const files = await inspectEventRelease(outputDirectory)
    console.log(`Validated ${files.length} event release artifacts in ${outputDirectory}.`)
  } else {
    const result = await writeEventReleasePackage(outputDirectory)
    console.log(`Wrote ${result.target} for ${result.files.length} event release artifacts.`)
  }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) main().catch(error => { console.error(error.message); process.exitCode = 1 })

export { PACKAGE_FILE, REQUIRED_ARTIFACTS, SECRET_PATTERN }
