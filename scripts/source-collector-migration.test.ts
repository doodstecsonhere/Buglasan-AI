import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration003 = readFileSync(new URL('../supabase/migrations/003_source_collector.sql', import.meta.url), 'utf8')
const migration004 = readFileSync(
  new URL('../supabase/migrations/004_fix_ingest_source_digest_resolution.sql', import.meta.url),
  'utf8',
)
const functionBody = migration004.match(/CREATE OR REPLACE FUNCTION public\.ingest_source[\s\S]*?\n\$\$;/)?.[0] ?? ''

describe('Phase 5 source collector migration contract', () => {
  it('is a source-only JSONB RPC with a hardened execution boundary', () => {
    expect(functionBody).toContain('p_payload JSONB')
    expect(functionBody).toContain('SECURITY DEFINER')
    expect(functionBody).toContain("SET search_path = pg_catalog, public")
    expect(migration004).toContain('REVOKE ALL ON FUNCTION public.ingest_source(JSONB) FROM PUBLIC')
    expect(migration004).toContain('GRANT EXECUTE ON FUNCTION public.ingest_source(JSONB) TO service_role')
  })

  it('does not write downstream knowledge tables', () => {
    expect(functionBody).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(?:source_chunks|events|event_sources)/i)
    expect(functionBody).not.toMatch(/embedding|ocr/i)
  })

  it('excludes collection and server timestamps from the semantic fingerprint', () => {
    const fingerprintExpression = functionBody.match(/v_fingerprint :=[\s\S]*?'sha256'::text\), 'hex'\);/)?.[0] ?? ''
    expect(fingerprintExpression).toContain("'source_metadata', v_source_metadata")
    expect(fingerprintExpression).not.toMatch(/collected_at|ingested_at|updated_at/)
  })

  it('schema-qualifies hosted pgcrypto without weakening the fixed search path', () => {
    expect(functionBody).toContain('extensions.digest(convert_to(jsonb_build_object(')
    expect(functionBody).toContain(")::TEXT, 'UTF8'), 'sha256'::text)")
    expect(functionBody).not.toMatch(/(?<!\.)\bdigest\s*\(/)
    expect(migration003).toContain("encode(digest(jsonb_build_object(")
  })

  it('preserves unique identity and locks before semantic updates', () => {
    expect(migration004).not.toMatch(/DROP\s+CONSTRAINT\s+unique_platform_post_id/i)
    expect(functionBody).toContain('FOR UPDATE')
    expect(functionBody).toContain('EXCEPTION WHEN unique_violation')
  })
})
