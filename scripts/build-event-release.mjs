import { spawn } from 'node:child_process'
import { PRODUCTION_TARGET, selectRegisteredEventReleasePackage } from '../config/release-package.mjs'

function fail(message) { throw new Error(`Invalid event release build: ${message}`) }

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32', env: environment })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with status ${code}`)))
  })
}

async function main() {
  const [targetId = PRODUCTION_TARGET, acknowledgement, ...extra] = process.argv.slice(2)
  if (extra.length) fail('usage: build-event-release.mjs [target-id] [reference-only]')
  const selectionOptions = acknowledgement ? { referenceOnlyAcknowledgement: acknowledgement } : undefined
  const releasePackage = selectRegisteredEventReleasePackage(targetId, selectionOptions)
  const environment = {
    ...process.env,
    EVENT_RELEASE_TARGET: releasePackage.targetId,
    ...(selectionOptions ? { EVENT_RELEASE_REFERENCE_ONLY_ACKNOWLEDGEMENT: selectionOptions.referenceOnlyAcknowledgement } : {}),
  }
  await run('npm', ['run', 'build'], environment)
  await run(process.execPath, ['scripts/package-event-release.mjs', '--write', releasePackage.targetId, releasePackage.outputDirectory, ...(acknowledgement ? [acknowledgement] : [])], environment)
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) main().catch(error => { console.error(error.message); process.exitCode = 1 })
