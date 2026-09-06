export const INDEXER_VERSION = 'semantic-index-v1'
export const CHUNK_TARGET = 1200
export const CHUNK_HARD_MAX = 1600

export interface SourceChunk {
  chunkIndex: number
  content: string
  contentHash: string
}

export function normalizeSourceText(input: string): string {
  if (typeof input !== 'string') throw new TypeError('source text must be a string')
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[\t\f ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitOversizeParagraph(paragraph: string): string[] {
  const sentences = paragraph.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean)
  const pieces: string[] = []
  let current = ''

  const emitLong = (value: string) => {
    let remaining = value.trim()
    while (remaining.length > CHUNK_HARD_MAX) {
      const window = remaining.slice(0, CHUNK_HARD_MAX + 1)
      const lastSpace = window.lastIndexOf(' ', CHUNK_HARD_MAX)
      const cut = lastSpace >= CHUNK_TARGET * 0.6 ? lastSpace : CHUNK_HARD_MAX
      pieces.push(remaining.slice(0, cut).trim())
      remaining = remaining.slice(cut).trim()
    }
    return remaining
  }

  for (const sentence of sentences) {
    if (sentence.length > CHUNK_HARD_MAX) {
      if (current) pieces.push(current)
      current = emitLong(sentence)
      continue
    }
    const candidate = current ? `${current} ${sentence}` : sentence
    if (candidate.length <= CHUNK_HARD_MAX) current = candidate
    else {
      if (current) pieces.push(current)
      current = sentence
    }
  }
  if (current) pieces.push(current)
  return pieces
}

export async function contentHash(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function chunkSourceText(input: string): Promise<SourceChunk[]> {
  const text = normalizeSourceText(input)
  if (!text) return []
  const units = text.length <= CHUNK_HARD_MAX
    ? [text]
    : text.split(/\n+/).map((part) => part.trim()).filter(Boolean)
      .flatMap((paragraph) => paragraph.length <= CHUNK_HARD_MAX ? [paragraph] : splitOversizeParagraph(paragraph))
  const contents: string[] = []
  let current = ''
  for (const unit of units) {
    const candidate = current ? `${current}\n\n${unit}` : unit
    if (current && current.length >= CHUNK_TARGET) {
      contents.push(current)
      current = unit
    } else if (candidate.length <= CHUNK_HARD_MAX) current = candidate
    else {
      if (current) contents.push(current)
      current = unit
    }
  }
  if (current) contents.push(current)
  if (contents.some((content) => content.length < 1 || content.length > CHUNK_HARD_MAX)) {
    throw new Error('chunking invariant violated')
  }
  return Promise.all(contents.map(async (content, chunkIndex) => ({
    chunkIndex,
    content,
    contentHash: await contentHash(content),
  })))
}
