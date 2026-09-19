import { describe, expect, it } from 'vitest'
import { AIDisclaimer } from './AIDisclaimer'
import { productConfig } from '../config/productConfig'

const text = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(text).join('')
  if (value && typeof value === 'object' && 'props' in value) return text((value as { props?: { children?: unknown } }).props?.children)
  return ''
}

describe('AIDisclaimer trust disclosure', () => {
  const output = text(AIDisclaimer())

  it('keeps the AI-error disclaimer and the official Facebook link', () => {
    expect(output).toContain(productConfig.trust.aiDisclaimer)
    expect(output).toContain(productConfig.officialSource.pageLabel)
    expect(JSON.stringify(AIDisclaimer())).toContain(productConfig.officialSource.url)
  })

  it('represents both material non-affiliation facts (never dropped for layout)', () => {
    expect(output).toContain('Data sourced from official channels.')
    expect(output).toContain('Not affiliated with the Provincial Government of Negros Oriental.')
    expect(output).toContain('Independent project')
  })
})
