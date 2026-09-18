-- Gate 2B: phase6-v2 is the current extraction processor after the bounded
-- provider-recovery fix. Older extraction tuples remain immutable audit state.
CREATE OR REPLACE FUNCTION public.get_orchestration_dispatch(
  p_source_id UUID,
  p_changed BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE
  src public.sources;
  extraction_status TEXT;
  extraction_lease_expires_at TIMESTAMPTZ;
  indexing_status TEXT;
  indexing_lease_expires_at TIMESTAMPTZ;
  candidate_ids JSONB := '[]'::JSONB;
  candidate_limit CONSTANT INTEGER := 25;
  remaining_candidate_count INTEGER := 0;
BEGIN
  IF p_source_id IS NULL OR p_changed IS NULL THEN RAISE EXCEPTION 'invalid orchestration dispatch request'; END IF;
  SELECT * INTO src FROM public.sources WHERE id = p_source_id;
  IF NOT FOUND OR NOT src.is_current OR src.status NOT IN ('active','updated','postponed') THEN
    RETURN jsonb_build_object('source_id', p_source_id, 'extraction', false, 'indexing', false, 'candidate_event_ids', '[]'::JSONB, 'remaining_candidate_count', 0, 'has_more_candidates', false);
  END IF;
  SELECT status, lease_expires_at INTO extraction_status, extraction_lease_expires_at FROM public.source_extractions WHERE source_id=src.id AND source_fingerprint=src.content_fingerprint AND extractor_version='phase6-v2' ORDER BY created_at DESC LIMIT 1;
  SELECT status, lease_expires_at INTO indexing_status, indexing_lease_expires_at FROM public.source_indexings WHERE source_id=src.id AND source_fingerprint=src.content_fingerprint AND indexer_version='semantic-index-v1' AND embedding_model='gemini-embedding-001' AND embedding_dimensions=768 ORDER BY created_at DESC LIMIT 1;
  IF extraction_status IS NULL OR extraction_status IN ('pending','retryable_error') OR (extraction_status='processing' AND extraction_lease_expires_at<=clock_timestamp()) THEN extraction_status := 'dispatch'; END IF;
  IF indexing_status IS NULL OR indexing_status IN ('pending','retryable_error') OR (indexing_status='processing' AND indexing_lease_expires_at<=clock_timestamp()) THEN indexing_status := 'dispatch'; END IF;
  WITH eligible AS (
    SELECT e.id, e.candidate_index FROM public.events e
    LEFT JOIN LATERAL (SELECT r.status, r.lease_expires_at FROM public.event_reconciliation_runs r WHERE r.candidate_event_id=e.id AND r.reconciler_version='reconciler-v1' ORDER BY r.created_at DESC LIMIT 1) r ON TRUE
    WHERE e.extracted_source_id=src.id AND e.source_fingerprint=src.content_fingerprint AND e.is_current AND e.extraction_identity IS NOT NULL AND e.event_name IS NOT NULL AND e.festival_year IS NOT NULL AND COALESCE(array_length(e.review_reasons,1),0)=0
      AND (r.status IS NULL OR r.status IN ('pending','retryable_error') OR (r.status='processing' AND r.lease_expires_at<=clock_timestamp()))
  ), bounded AS (SELECT id, candidate_index, count(*) OVER () AS total_count FROM eligible ORDER BY candidate_index, id LIMIT candidate_limit)
  SELECT COALESCE(jsonb_agg(id ORDER BY candidate_index, id), '[]'::JSONB), GREATEST(COALESCE(max(total_count), 0) - candidate_limit, 0) INTO candidate_ids, remaining_candidate_count FROM bounded;
  RETURN jsonb_build_object('source_id', src.id, 'extraction', extraction_status='dispatch', 'indexing', indexing_status='dispatch', 'candidate_event_ids', candidate_ids, 'candidate_limit', candidate_limit, 'remaining_candidate_count', remaining_candidate_count, 'has_more_candidates', remaining_candidate_count > 0);
END $$;