import { describe, expect, it } from 'vitest'
import { CHUNK_HARD_MAX, chunkSourceText, contentHash, normalizeSourceText } from './chunking.ts'

describe('semantic chunking', () => {
  it('normalizes deterministically and removes empty input', async () => {
    expect(normalizeSourceText(' \r\n A\t  B\u00a0 \r\n\r\n\r\n C ')).toBe('A B\n\nC')
    expect(await chunkSourceText(' \t\r\n ')).toEqual([])
  })

  it('keeps short text and hashes exact UTF-8 content', async () => {
    const chunks = await chunkSourceText('Buglasan 🎉')
    expect(chunks).toEqual([{ chunkIndex: 0, content: 'Buglasan 🎉', contentHash: await contentHash('Buglasan 🎉') }])
    expect(chunks[0].contentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('packs paragraphs in order without exceeding the hard maximum', async () => {
    const input = `${'a'.repeat(700)}\n\n${'b'.repeat(700)}\n\n${'c'.repeat(100)}`
    const chunks = await chunkSourceText(input)
    expect(chunks.map((chunk) => chunk.content)).toEqual([`${'a'.repeat(700)}\n\n${'b'.repeat(700)}`, 'c'.repeat(100)])
    expect(chunks.every((chunk) => chunk.content.length <= CHUNK_HARD_MAX)).toBe(true)
  })

  it('splits oversized sentences at a late space and hard-cuts unbroken text', async () => {
    const spaced = await chunkSourceText(`${'word '.repeat(400)}End.`)
    const unbroken = await chunkSourceText('界'.repeat(3300))
    expect(spaced.every((chunk) => chunk.content.length <= CHUNK_HARD_MAX)).toBe(true)
    expect(unbroken.map((chunk) => chunk.content.length)).toEqual([1600, 1600, 100])
  })

  it('is byte-identical across repeated calls', async () => {
    const input = `${'First sentence. '.repeat(150)}https://example.test/ñ?x=🎉`
    expect(await chunkSourceText(input)).toEqual(await chunkSourceText(input))
  })
})
