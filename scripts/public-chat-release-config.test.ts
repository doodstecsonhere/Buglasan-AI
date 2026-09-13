import { describe, expect, it } from 'vitest'
import { assertPublicChatReleaseConfig, PUBLIC_CHAT_ENDPOINT } from './public-chat-release-config.mjs'

describe('production public chat release configuration', () => {
  it('rejects a production build that lacks a public chat endpoint', () => {
    expect(() => assertPublicChatReleaseConfig({ VITE_SUPABASE_PUBLISHABLE_KEY: 'public-key' })).toThrow('VITE_CHAT_ENDPOINT')
  })

  it('accepts only the public project endpoint and publishable key', () => {
    expect(assertPublicChatReleaseConfig({
      VITE_CHAT_ENDPOINT: PUBLIC_CHAT_ENDPOINT,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'public-key',
    })).toBe(PUBLIC_CHAT_ENDPOINT)
  })
})
