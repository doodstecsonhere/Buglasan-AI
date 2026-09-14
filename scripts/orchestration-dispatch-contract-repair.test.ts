import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const originalSql = readFileSync('supabase/migrations/013_orchestration_status.sql', 'utf8')
const repairSql = readFileSync('supabase/migrations/018_repair_orchestration_dispatch_contract.sql', 'utf8')
const lowerRepairSql = repairSql.toLowerCase()

function dispatchFunctionBody(sql: string): string {
  const match = sql.match(/CREATE OR REPLACE FUNCTION public\.get_orchestration_dispatch[\s\S]*?\$\$;/i)
  if (!match) throw new Error('get_orchestration_dispatch definition missing')
  return match[0]
}

function returnContracts(sql: string): string[] {
  return [...dispatchFunctionBody(sql).matchAll(/RETURN jsonb_build_object\(([\s\S]*?)\);/gi)].map((match) => match[1])
}

describe('Gate B orchestration dispatch contract repair', () => {
  it('is a forward-only function replacement and leaves migration 013 frozen', () => {
    expect(lowerRepairSql).toContain('create or replace function public.get_orchestration_dispatch')
    expect(lowerRepairSql).not.toMatch(/(?:alter|drop|truncate|delete|insert|update)\s+(?:table\s+)?public\./)
    expect(originalSql).toContain("RETURN jsonb_build_object('source_id', p_source_id, 'extraction', false, 'indexing', false, 'candidate_event_ids', '[]'::JSONB);")
  })

  it('makes every returned object expose mandatory typed continuation fields', () => {
    const contracts = returnContracts(repairSql)
    expect(contracts).toHaveLength(2)
    for (const contract of contracts) {
      expect(contract).toMatch(/'remaining_candidate_count'\s*,\s*(?:0|remaining_candidate_count)/i)
      expect(contract).toMatch(/'has_more_candidates'\s*,\s*(?:false|remaining_candidate_count\s*>\s*0)/i)
    }
  })

  it('keeps the computed count nonnegative and the continuation flag derived from it', () => {
    expect(lowerRepairSql).toContain('greatest(coalesce(max(total_count), 0) - candidate_limit, 0)')
    expect(lowerRepairSql).toContain("'has_more_candidates', remaining_candidate_count > 0")
  })

  it('preserves the frozen planner body outside the repaired compact return', () => {
    const ineligibleBranch = /IF NOT FOUND OR NOT src\.is_current OR src\.status NOT IN \('active','updated','postponed'\) THEN[\s\S]*?END IF;/i
    const normalizedOriginal = dispatchFunctionBody(originalSql).replace(ineligibleBranch, '<ineligible-branch>').replace(/\s+/g, ' ').trim()
    const normalizedRepair = dispatchFunctionBody(repairSql).replace(ineligibleBranch, '<ineligible-branch>').replace(/\s+/g, ' ').trim()
    expect(normalizedRepair).toBe(normalizedOriginal)
  })
})
