/**
 * Buglasan AI - Vitest Configuration
 *
 * Phase 6: Minimal config — jsdom env for any future DOM-touching tests,
 * explicit includes for src + tests. Excludes the Deno Edge Function tests.
 */
/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist', 'supabase/**'],
  },
})
