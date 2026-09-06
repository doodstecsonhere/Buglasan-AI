import { describe, expect, it, vi } from 'vitest'
import { EMBEDDING_DIMENSIONS, EmbeddingFailure, generateDocumentEmbeddings, generateQueryEmbedding, normalizeEmbedding } from './embedding.ts'

const vector = (value = 1) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => value)
const response = (values = vector(), status = 200) => new Response(JSON.stringify({ embedding: { values } }), { status })

describe('embedding provider boundary', () => {
  it('uses retrieval task types and preserves document order', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      const value = body.content.parts[0].text === 'second' ? 2 : 1
      return response(vector(value))
    })
    await generateQueryEmbedding('query', { apiKey: 'secret', fetch })
    const documents = await generateDocumentEmbeddings(['first', 'second'], { apiKey: 'secret', fetch })
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).taskType).toBe('RETRIEVAL_QUERY')
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).taskType).toBe('RETRIEVAL_DOCUMENT')
    expect(documents).toHaveLength(2)
  })

  it('accepts the plural embedding envelope returned by gemini-embedding-001', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ embeddings: [{ values: vector() }] })))
    const result = await generateDocumentEmbeddings(['document'], { apiKey: 'secret', fetch })
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(EMBEDDING_DIMENSIONS)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('strictly validates dimensions, finite values, and magnitude', () => {
    expect(Math.sqrt(normalizeEmbedding(vector()).reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1)
    for (const invalid of [vector().slice(1), [...vector().slice(1), Number.NaN], Array(EMBEDDING_DIMENSIONS).fill(0)]) {
      expect(() => normalizeEmbedding(invalid)).toThrow(EmbeddingFailure)
    }
  })

  it('retries transient responses exactly three times with bounded delays', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 503 }))
    const sleep = vi.fn(async () => {})
    await expect(generateQueryEmbedding('query', { apiKey: 'secret', fetch, sleep })).rejects.toMatchObject({ code: 'embedding_upstream_unavailable' })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[250], [500]])
  })

  it('does not retry permanent or malformed successful responses', async () => {
    for (const result of [new Response('', { status: 400 }), response([])]) {
      const fetch = vi.fn(async () => result)
      await expect(generateQueryEmbedding('query', { apiKey: 'secret', fetch, sleep: async () => {} })).rejects.toBeInstanceOf(EmbeddingFailure)
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  })
})
