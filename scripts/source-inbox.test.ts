import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
let temporaryDirectory: string | null = null

afterEach(async () => {
  if (temporaryDirectory !== null) await rm(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = null
})

describe('Source Inbox CLI caption transport', () => {
  it('preserves a UTF-8 multiline Unicode caption supplied through a local file', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'buglasan-source-inbox-'))
    const caption = 'Buglasan 2026\nHibalag sa Kabukiran 🌾\nMabuhay, Negros Oriental!'
    const captionFile = join(temporaryDirectory, 'caption.txt')
    await writeFile(captionFile, caption, 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'node_modules/vite-node/vite-node.mjs',
      'scripts/source-inbox.ts',
      '--post-url', 'https://www.facebook.com/Buglasan/posts/123',
      '--caption-file', captionFile,
    ])

    expect(JSON.parse(stdout)).toMatchObject({ operator_caption: caption })
  }, 15_000)

  it('normalizes a whitespace-only UTF-8 caption file to a null operator caption', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'buglasan-source-inbox-'))
    const captionFile = join(temporaryDirectory, 'caption.txt')
    await writeFile(captionFile, ' \n\t  ', 'utf8')

    const { stdout } = await execFileAsync(process.execPath, [
      'node_modules/vite-node/vite-node.mjs',
      'scripts/source-inbox.ts',
      '--post-url', 'https://www.facebook.com/Buglasan/posts/123',
      '--caption-file', captionFile,
    ])

    expect(JSON.parse(stdout)).toMatchObject({ operator_caption: null })
  }, 15_000)

  it('rejects simultaneous inline and file caption inputs', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'buglasan-source-inbox-'))
    const captionFile = join(temporaryDirectory, 'caption.txt')
    await writeFile(captionFile, 'File caption', 'utf8')
    await expect(execFileAsync(process.execPath, [
      'node_modules/vite-node/vite-node.mjs',
      'scripts/source-inbox.ts',
      '--post-url', 'https://www.facebook.com/Buglasan/posts/123',
      '--caption', 'Inline caption',
      '--caption-file', captionFile,
    ])).rejects.toMatchObject({ stderr: expect.stringMatching(/either --caption or --caption-file/i) })
  }, 15_000)
})
