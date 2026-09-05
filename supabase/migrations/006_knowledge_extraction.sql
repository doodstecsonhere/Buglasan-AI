-- Phase 6 Workflow B: evidence-grounded extraction. No chunks or embeddings.
ALTER TABLE public.events
  ALTER COLUMN description DROP NOT NULL,
  ALTER COLUMN category DROP NOT NULL,
  ALTER COLUMN start_datetime DROP NOT NULL,
  ALTER COLUMN end_datetime DROP NOT NULL,
  ALTER COLUMN venue DROP NOT NULL,
  ALTER COLUMN organizer DROP NOT NULL,
  ALTER COLUMN status DROP NOT NULL,
  ALTER COLUMN festival_year DROP NOT NULL;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS extraction_identity TEXT,
  ADD COLUMN IF NOT EXISTS extracted_source_id UUID REFERENCES public.sources(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS extractor_version TEXT,
  ADD COLUMN IF NOT EXISTS candidate_index INTEGER,
  ADD COLUMN IF NOT EXISTS extraction_evidence JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS review_reasons TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

ALTER TABLE public.events
  ADD CONSTRAINT events_extraction_identity_unique UNIQUE (extraction_identity),
  ADD CONSTRAINT events_candidate_index_nonnegative CHECK (candidate_index IS NULL OR candidate_index >= 0),
  ADD CONSTRAINT events_extraction_evidence_array CHECK (jsonb_typeof(extraction_evidence) = 'array'),
  ADD CONSTRAINT events_extraction_columns_together CHECK (
    (extraction_identity IS NULL AND extracted_source_id IS NULL AND source_fingerprint IS NULL AND extractor_version IS NULL AND candidate_index IS NULL)
    OR
    (extraction_identity IS NOT NULL AND extracted_source_id IS NOT NULL AND source_fingerprint IS NOT NULL AND extractor_version IS NOT NULL AND candidate_index IS NOT NULL)
  );

CREATE TABLE public.source_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  source_fingerprint TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','processing','extracted','no_event','needs_review','retryable_error','permanent_error'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT,
  last_error_message TEXT,
  result_json JSONB,
  review_reasons TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  claim_token UUID,
  lease_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, source_fingerprint, extractor_version),
  CHECK (result_json IS NULL OR jsonb_typeof(result_json) = 'object')
);

CREATE INDEX idx_source_extractions_source_latest ON public.source_extractions (source_id, created_at DESC);
CREATE INDEX idx_source_extractions_status ON public.source_extractions (status);

CREATE TRIGGER update_source_extractions_updated_at
  BEFORE UPDATE ON public.source_extractions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.source_extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access for source_extractions" ON public.source_extractions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Remove the historical public chunk policy. Workflow B neither reads nor writes chunks.
DROP POLICY IF EXISTS "Public read access for source_chunks" ON public.source_chunks;

CREATE OR REPLACE FUNCTION public.claim_source_extraction(
  p_source_id UUID, p_source_fingerprint TEXT, p_extractor_version TEXT,
  p_claim_token UUID, p_lease_seconds INTEGER DEFAULT 60
) RETURNS public.source_extractions
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE v_row public.source_extractions;
BEGIN
  IF p_claim_token IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'invalid extraction lease';
  END IF;
  INSERT INTO public.source_extractions (source_id, source_fingerprint, extractor_version, status)
  VALUES (p_source_id, p_source_fingerprint, p_extractor_version, 'pending')
  ON CONFLICT (source_id, source_fingerprint, extractor_version) DO NOTHING;

  SELECT * INTO v_row FROM public.source_extractions
  WHERE source_id = p_source_id AND source_fingerprint = p_source_fingerprint
    AND extractor_version = p_extractor_version FOR UPDATE;

  IF v_row.status IN ('extracted','no_event','needs_review','permanent_error') THEN RETURN v_row; END IF;
  IF v_row.status = 'processing' AND v_row.lease_expires_at > clock_timestamp() THEN RETURN v_row; END IF;
  UPDATE public.source_extractions SET status = 'processing', attempt_count = attempt_count + 1,
    claim_token = p_claim_token, lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    started_at = clock_timestamp(), completed_at = NULL, last_error_code = NULL, last_error_message = NULL
  WHERE id = v_row.id RETURNING * INTO v_row;
  RETURN v_row;
END; $$;

CREATE OR REPLACE FUNCTION public.persist_source_extraction(
  p_extraction_id UUID, p_claim_token UUID, p_source_id UUID, p_source_fingerprint TEXT, p_extractor_version TEXT,
  p_status TEXT, p_result JSONB, p_review_reasons TEXT[] DEFAULT '{}'::TEXT[]
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE v_source public.sources; v_state public.source_extractions; v_candidate JSONB; v_event_id UUID; v_index INTEGER; v_count INTEGER := 0;
BEGIN
  IF p_status NOT IN ('extracted','no_event','needs_review') THEN RAISE EXCEPTION 'invalid terminal status'; END IF;
  SELECT * INTO v_source FROM public.sources WHERE id = p_source_id FOR UPDATE;
  IF NOT FOUND OR v_source.content_fingerprint IS DISTINCT FROM p_source_fingerprint THEN RAISE EXCEPTION 'stale source fingerprint'; END IF;
  SELECT * INTO v_state FROM public.source_extractions WHERE id = p_extraction_id FOR UPDATE;
  IF NOT FOUND OR v_state.source_id <> p_source_id OR v_state.source_fingerprint <> p_source_fingerprint
     OR v_state.extractor_version <> p_extractor_version OR v_state.status <> 'processing'
     OR v_state.claim_token IS DISTINCT FROM p_claim_token OR v_state.lease_expires_at <= clock_timestamp()
     THEN RAISE EXCEPTION 'invalid or expired extraction claim'; END IF;
  IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object' OR jsonb_typeof(p_result->'candidates') <> 'array' THEN RAISE EXCEPTION 'invalid result'; END IF;

  -- A source edit replaces only that source's currently retrievable extractor output.
  -- Rows remain for audit, but cannot coexist as current with the new fingerprint.
  UPDATE public.events SET is_current = FALSE, updated_at = clock_timestamp()
  WHERE extracted_source_id = p_source_id AND is_current
    AND source_fingerprint IS DISTINCT FROM p_source_fingerprint;

  FOR v_candidate, v_index IN SELECT value, (ordinality - 1)::INTEGER FROM jsonb_array_elements(p_result->'candidates') WITH ORDINALITY LOOP
    IF NULLIF(btrim(v_candidate->>'event_name'), '') IS NULL THEN CONTINUE; END IF; -- null names remain review-only
    INSERT INTO public.events (
      event_name, aliases, description, category, start_datetime, end_datetime, venue, organizer,
      deadline, eligibility, fees, contact_info, status, festival_year, extraction_identity,
      extracted_source_id, source_fingerprint, extractor_version, candidate_index, extraction_evidence, review_reasons
    ) VALUES (
      btrim(v_candidate->>'event_name'), COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_candidate->'aliases')), '{}'::TEXT[]),
      v_candidate->>'description', v_candidate->>'category', (v_candidate->>'start_datetime')::TIMESTAMPTZ,
      (v_candidate->>'end_datetime')::TIMESTAMPTZ, v_candidate->>'venue', v_candidate->>'organizer',
      (v_candidate->>'deadline')::TIMESTAMPTZ, v_candidate->>'eligibility', v_candidate->>'fees', v_candidate->>'contact_info',
      v_candidate->>'status', (v_candidate->>'festival_year')::INTEGER,
      p_source_id::TEXT || ':' || p_source_fingerprint || ':' || p_extractor_version || ':' || v_index,
      p_source_id, p_source_fingerprint, p_extractor_version, v_index, v_candidate->'evidence',
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_candidate->'review_reasons')), '{}'::TEXT[])
    ) ON CONFLICT (extraction_identity) DO UPDATE SET
      event_name = EXCLUDED.event_name, aliases = EXCLUDED.aliases, description = EXCLUDED.description,
      category = EXCLUDED.category, start_datetime = EXCLUDED.start_datetime, end_datetime = EXCLUDED.end_datetime,
      venue = EXCLUDED.venue, organizer = EXCLUDED.organizer, deadline = EXCLUDED.deadline,
      eligibility = EXCLUDED.eligibility, fees = EXCLUDED.fees, contact_info = EXCLUDED.contact_info,
      status = EXCLUDED.status, festival_year = EXCLUDED.festival_year, extraction_evidence = EXCLUDED.extraction_evidence,
      review_reasons = EXCLUDED.review_reasons, is_current = TRUE, updated_at = clock_timestamp()
    RETURNING id INTO v_event_id;
    INSERT INTO public.event_sources (event_id, source_id, relevance_score) VALUES (v_event_id, p_source_id, 1.0)
      ON CONFLICT (event_id, source_id) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.source_extractions SET status = p_status, result_json = p_result, review_reasons = p_review_reasons,
    completed_at = clock_timestamp(), claim_token = NULL, lease_expires_at = NULL,
    last_error_code = NULL, last_error_message = NULL WHERE id = p_extraction_id;
  RETURN jsonb_build_object('status', p_status, 'persisted_candidates', v_count);
END; $$;

CREATE OR REPLACE FUNCTION public.fail_source_extraction(
  p_extraction_id UUID, p_claim_token UUID, p_status TEXT, p_error_code TEXT, p_error_message TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
BEGIN
  IF p_status NOT IN ('retryable_error','permanent_error') THEN RAISE EXCEPTION 'invalid error status'; END IF;
  UPDATE public.source_extractions SET status = p_status, last_error_code = left(p_error_code, 100),
    last_error_message = left(p_error_message, 2000), completed_at = clock_timestamp(),
    claim_token = NULL, lease_expires_at = NULL
  WHERE id = p_extraction_id AND status = 'processing' AND claim_token = p_claim_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid extraction claim'; END IF;
END; $$;

CREATE OR REPLACE VIEW public.extraction_review_queue WITH (security_invoker = true) AS
SELECT e.source_id, s.post_url, e.result_json, e.review_reasons,
  ARRAY(SELECT c->>'festival_year' FROM jsonb_array_elements(COALESCE(e.result_json->'candidates','[]'::JSONB)) c) AS years,
  ARRAY(SELECT c->>'event_name' FROM jsonb_array_elements(COALESCE(e.result_json->'candidates','[]'::JSONB)) c) AS names,
  e.attempt_count AS latest_attempt, e.last_error_code, e.last_error_message, e.updated_at
FROM public.source_extractions e JOIN public.sources s ON s.id = e.source_id
WHERE e.status IN ('needs_review','retryable_error','permanent_error');

REVOKE ALL ON FUNCTION public.claim_source_extraction(UUID,TEXT,TEXT,UUID,INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.persist_source_extraction(UUID,UUID,UUID,TEXT,TEXT,TEXT,JSONB,TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_source_extraction(UUID,UUID,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_source_extraction(UUID,TEXT,TEXT,UUID,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.persist_source_extraction(UUID,UUID,UUID,TEXT,TEXT,TEXT,JSONB,TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_source_extraction(UUID,UUID,TEXT,TEXT,TEXT) TO service_role;
REVOKE ALL ON public.source_extractions, public.extraction_review_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.source_extractions TO service_role;
GRANT SELECT ON public.extraction_review_queue TO service_role;

COMMENT ON TABLE public.source_extractions IS 'Auditable per-source/fingerprint/version extraction attempts; source evidence is never mutated.';
COMMENT ON FUNCTION public.persist_source_extraction(UUID,UUID,UUID,TEXT,TEXT,TEXT,JSONB,TEXT[]) IS 'Conservative atomic persistence: source-local exact-fingerprint replacement; no fuzzy matching, chunks, or embeddings.';
