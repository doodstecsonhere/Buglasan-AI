import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationsUrl = new URL('../supabase/migrations/', import.meta.url)
const migrationFiles = readdirSync(migrationsUrl).filter((name) => name.endsWith('.sql')).sort()
const migration006 = readFileSync(new URL('006_knowledge_extraction.sql', migrationsUrl), 'utf8')
const migration007 = readFileSync(new URL('007_fix_extracted_event_audit_current.sql', migrationsUrl), 'utf8')
const migration008 = readFileSync(new URL('008_sync_event_current_status.sql', migrationsUrl), 'utf8')

describe('Phase 6 migration', () => {
  it('preserves the complete ordered 001-007 migration chain', () => {
    expect(migrationFiles).toEqual([
      '001_initial_schema.sql',
      '002_fix_embedding_dimension_and_status_model.sql',
      '003_source_collector.sql',
      '004_fix_ingest_source_digest_resolution.sql',
      '005_use_manila_post_year.sql',
      '006_knowledge_extraction.sql',
      '007_fix_extracted_event_audit_current.sql',
      '008_sync_event_current_status.sql',
    ])
  })

  it('restores status-derived current state while preserving stale extraction audit rows', () => {
    expect(migration008).toContain('BEFORE INSERT OR UPDATE OF status ON public.events')
    expect(migration008).toContain("NEW.status IN ('scheduled', 'confirmed')")
    expect(migration008).toContain('NEW.source_fingerprint IS NOT DISTINCT FROM v_source_fingerprint')
    expect(migration008).toContain('UPDATE public.events e')
    expect(migration008).toContain('REVOKE ALL ON FUNCTION public.sync_event_is_current() FROM PUBLIC, anon, authenticated')
  })

  it('keeps the deployed 006/007 forward fix ordered and fresh-replay safe', () => {
    expect(migration006).not.toContain('ALTER COLUMN is_current DROP EXPRESSION')
    expect(migration007.match(/ALTER COLUMN is_current DROP EXPRESSION/g)).toHaveLength(1)
    expect(migration007).toContain('ALTER COLUMN is_current SET DEFAULT TRUE')
    expect(migration007).toContain('Independently false for prior extraction fingerprints retained as audit rows.')
  })

  it('has all extraction states and fingerprint/version uniqueness', () => {
    for (const state of ['pending','processing','extracted','no_event','needs_review','retryable_error','permanent_error']) expect(migration006).toContain(`'${state}'`)
    expect(migration006).toContain('UNIQUE (source_id, source_fingerprint, extractor_version)')
  })
  it('keeps canonical names non-null while nullable facts are allowed', () => {
    expect(migration006).not.toMatch(/event_name DROP NOT NULL/)
    for (const field of ['description','category','start_datetime','end_datetime','venue','organizer','festival_year']) expect(migration006).toContain(`ALTER COLUMN ${field} DROP NOT NULL`)
  })
  it('uses conservative identity, exact provenance, and service-only access', () => {
    expect(migration006).toContain("p_source_id::TEXT || ':' || p_source_fingerprint || ':' || p_extractor_version || ':' || v_index")
    expect(migration006).toContain('INSERT INTO public.event_sources')
    expect(migration006).toContain('stale source fingerprint')
    expect(migration006).toContain('claim_token')
    expect(migration006).toContain('lease_expires_at')
    expect(migration006).toContain("v_row.status = 'processing' AND v_row.lease_expires_at > clock_timestamp()")
    expect(migration006).toContain('source_fingerprint IS DISTINCT FROM p_source_fingerprint')
    expect(migration006).toContain('UPDATE public.events SET is_current = FALSE')
    expect(migration006).toContain('DROP POLICY IF EXISTS "Public read access for source_chunks"')
    expect(migration006).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.source_chunks/i)
    expect(migration006).not.toMatch(/CREATE\s+(?:INDEX|TABLE).*embedding/i)
    expect(migration006).toContain('REVOKE ALL ON public.source_extractions, public.extraction_review_queue FROM PUBLIC, anon, authenticated')
  })
  it('exposes required review context', () => {
    for (const term of ['source_id','post_url','result_json','review_reasons','years','names','latest_attempt']) expect(migration006).toContain(term)
  })
})
