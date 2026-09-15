import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { productConfig } from '../src/config/productConfig'

describe('production branding', () => {
  it('does not render demo wording in the production app shell', () => {
    const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

    expect(productConfig.branding.wordmark).toBe('BUGLASAN AI')
    expect(appSource).toContain('{productConfig.branding.wordmark}</p>')
    expect(appSource).not.toContain('BUGLASAN AI (DEMO)')
  })
})
