import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertInspectionOnly, inspect, recordInspection, PROJECT, SOURCE_IDS } from './phase10-terminal-retry.ts'

describe('Phase 10 stopped operator contract', () => {
  it('has only the four authorized sources and exact project', () => {
    expect(SOURCE_IDS).toHaveLength(4)
    expect(new Set(SOURCE_IDS).size).toBe(4)
    expect(SOURCE_IDS).not.toContain('254d56af-7bf4-4913-8a9b-d5ab34367b33')
    expect(PROJECT).toBe('https://uelezensmkxfyexcwqzb.supabase.co')
  })
  it('defaults to inspection and refuses execution, bypasses and arbitrary IDs', () => {
    expect(() => assertInspectionOnly([])).not.toThrow()
    expect(() => assertInspectionOnly(['--inspect'])).not.toThrow()
    for (const flag of ['--execute', '--no-reconcile', SOURCE_IDS[0]]) expect(() => assertInspectionOnly([flag])).toThrow('STOP')
  })
  it('only reads fixed source-scoped rows sequentially', async () => {
    const urls: string[] = []
    const request = async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('GET')
      expect(init?.redirect).toBe('error')
      urls.push(String(url))
      return new Response(JSON.stringify(String(url).includes('/sources?') ? [{ id: 'snapshot' }] : []))
    }
    const report = await inspect('local-fake-key', request as typeof fetch)
    expect(report.read_only).toBe(true)
    expect(report.execution_blocked).toContain('unproven')
    expect(urls).toHaveLength(16)
    urls.forEach((url) => {
      expect(url.startsWith(PROJECT + '/rest/v1/')).toBe(true)
      expect(SOURCE_IDS.some((id) => url.includes(id))).toBe(true)
      expect(url).not.toMatch(/rpc|functions|254d56af/)
    })
  })
  it('fails closed without a network retry', async () => {
    let calls = 0
    await expect(inspect('fake', (async () => { calls++; return new Response('', { status: 503 }) }) as typeof fetch)).rejects.toThrow('503')
    expect(calls).toBe(1)
    await expect(inspect('')).rejects.toThrow('credential')
  })
  for (const failure of [false, true]) it(`retains a ${failure ? 'partial' : 'complete'} receipt and refuses rerun before networking`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'phase10-receipt-'))
    const receipt = join(directory, 'inspection.json')
    let calls = 0
    const request = (async (url: string | URL | Request) => {
      calls++
      const started = JSON.parse(readFileSync(receipt, 'utf8'))
      expect(started).toEqual({ state: 'inspection_started', project: PROJECT })
      if (failure) throw new Error('ambiguous network failure')
      return new Response(JSON.stringify(String(url).includes('/sources?') ? [{ id: 'snapshot', raw_text: 'full evidence' }] : []))
    }) as typeof fetch
    try {
      if (failure) await expect(recordInspection('fake', receipt, request)).rejects.toThrow('ambiguous')
      else {
        const report = await recordInspection('fake', receipt, request)
        expect(JSON.parse(readFileSync(receipt, 'utf8').split('\n')[1])).toEqual(report)
      }
      const before = readFileSync(receipt, 'utf8')
      expect(before.split('\n')).toHaveLength(failure ? 1 : 2)
      expect(calls).toBe(failure ? 1 : 16)
      await expect(recordInspection('fake', receipt, request)).rejects.toThrow(/EEXIST/)
      expect(calls).toBe(failure ? 1 : 16)
      expect(readFileSync(receipt, 'utf8')).toBe(before)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
