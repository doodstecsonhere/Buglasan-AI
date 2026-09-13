import { describe, expect, it } from 'vitest'

describe('production demo-mode boundary', () => {
  it('treats only an explicit true value as enabling demo mode', () => {
    expect(import.meta.env.VITE_DEMO_MODE === 'true').toBe(false)
  })
})
