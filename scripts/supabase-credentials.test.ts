import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { transpile } from 'typescript'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('Supabase credential boundaries', () => {
  it.each(['chat', 'extract-source'])('%s uses only the hosted default secret', (name) => {
    const code = read(`supabase/functions/${name}/index.ts`)
    const declarations = code.match(/const secretKeys = [^\n]+\nconst (secretKey|SERVICE_KEY) = [^\n]+/)
    expect(declarations).not.toBeNull()
    const reads: string[] = []
    const selected = runInNewContext(transpile(`${declarations![0]}; ${declarations![1]}`), {
      Deno: { env: { get: (key: string) => {
        reads.push(key)
        return JSON.stringify({ other: 'not-the-default', default: 'hosted-default' })
      } } },
    })
    expect(selected).toBe('hosted-default')
    expect(reads).toEqual(['SUPABASE_SECRET_KEYS'])
    expect(code).not.toContain("Deno.env.get('SUPABASE_SECRET_KEY')")
  })

  it('explicitly exposes only the publishable key through Vite', () => {
    const config = read('vite.config.ts')
    expect(config).toContain("loadEnv(mode, process.cwd(), 'SUPABASE_PUBLISHABLE_KEY')")
    expect(config).toContain("'import.meta.env.SUPABASE_PUBLISHABLE_KEY': JSON.stringify(SUPABASE_PUBLISHABLE_KEY ?? '')")
    expect(config).not.toContain('SUPABASE_SECRET')
    expect(config).not.toContain('envPrefix')
    expect(read('src/services/chatService.ts')).not.toContain('SUPABASE_SECRET')
  })

  it.each(['seed-smoke-test', 'source-collector-live', 'knowledge-extraction-live'])('%s uses the local secret key without bearer authentication', (name) => {
    const code = read(`scripts/${name}.ts`)
    expect(code).toContain('SUPABASE_SECRET_KEY')
    expect(code).not.toContain('Bearer ')
  })

  it('disables JWT verification for opaque-key chat and token-authenticated extraction', () => {
    const config = read('supabase/config.toml')
    for (const name of ['chat', 'extract-source']) {
      expect(config).toMatch(new RegExp(`\\[functions\\.${name}\\][^\\[]*verify_jwt = false`))
    }
  })
})
