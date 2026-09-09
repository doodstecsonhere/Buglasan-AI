import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('loads documented local operator configuration before snapshotting live acceptance variables', () => {
  const source = readFileSync(new URL('./event-reconciliation-live.ts', import.meta.url), 'utf8')
  expect(source.indexOf("process.loadEnvFile('.env.local')")).toBeGreaterThanOrEqual(0)
  expect(source.indexOf("process.loadEnvFile('.env.local')")).toBeLessThan(source.indexOf('const url = process.env.SUPABASE_URL'))
})
