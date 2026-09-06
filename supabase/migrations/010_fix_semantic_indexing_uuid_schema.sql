-- Phase 7 hotfix: uuid-ossp is installed in the extensions schema on hosted Supabase.
DO $$
DECLARE definition TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'persist_source_indexing'
    AND pg_get_function_identity_arguments(p.oid) = 'p_indexing_id uuid, p_claim_token uuid, p_source_id uuid, p_source_fingerprint text, p_indexer_version text, p_embedding_model text, p_embedding_dimensions integer, p_status text, p_chunks jsonb, p_review_reasons text[]';

  IF definition IS NULL THEN RAISE EXCEPTION 'persist_source_indexing function not found'; END IF;
  definition := replace(definition, 'public.uuid_generate_v5(public.uuid_ns_url()', 'extensions.uuid_generate_v5(extensions.uuid_ns_url()');
  IF position('extensions.uuid_generate_v5(extensions.uuid_ns_url()' IN definition) = 0 THEN RAISE EXCEPTION 'persist_source_indexing UUID expression was not patched'; END IF;
  EXECUTE definition;
END $$;
