import { afterEach, describe, expect, it, vi } from 'vitest'
import { INSTALL_DISMISSED_STORAGE_KEY, readInstallDismissed, writeInstallDismissed } from './installPrompt'

describe('install dismissal storage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('falls back to an undismissed prompt when storage reads throw', () => {
    const localStorage = { getItem: vi.fn(() => { throw new Error('blocked') }), setItem: vi.fn() }
    vi.stubGlobal('window', { localStorage })
    expect(readInstallDismissed()).toBe(false)
  })

  it('does not throw when storage writes are blocked', () => {
    const localStorage = { getItem: vi.fn(), setItem: vi.fn(() => { throw new Error('blocked') }) }
    vi.stubGlobal('window', { localStorage })
    expect(() => writeInstallDismissed()).not.toThrow()
    expect(INSTALL_DISMISSED_STORAGE_KEY).toBe('buglasan-install-dismissed')
  })
})
