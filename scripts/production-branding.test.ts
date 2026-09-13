import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('production branding', () => {
  it('does not render demo wording in the production app shell', () => {
    const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

    expect(appSource).toContain('BUGLASAN AI</p>')
    expect(appSource).not.toContain('BUGLASAN AI (DEMO)')
  })
})
