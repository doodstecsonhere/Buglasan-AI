-- Repository-only Phase 10 contract. Deployment/execution require separate approval.
-- No source/content/canonical mutation. No reconciliation calls.
-- Migration 006 granted ALL: row triggers cannot intercept TRUNCATE.
-- No application history-deletion route requires this statement privilege.
REVOKE TRUNCATE ON public.source_extractions FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE public.phase10_terminal_retry_audit (
  source_id UUID NOT NULL,
  source_fingerprint TEXT NOT NULL,
  extractor_version TEXT NOT NULL CHECK (extractor_version = 'phase6-v1'),
  extraction_id UUID NOT NULL UNIQUE,
  claim_token UUID NOT NULL UNIQUE,
  source_before JSONB NOT NULL,
  extraction_before JSONB NOT NULL,
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (source_id, source_fingerprint, extractor_version),
  CHECK (source_id IN ('0f73eba4-daa0-48ca-82a8-a4ae02284793'::UUID,
    '2d9a28eb-a142-4bc2-b694-530d141e0cbc'::UUID,
    '8f0d3c75-a084-410c-8d1b-0800655cec21'::UUID,
    'b025846e-1928-4ac9-95dd-cf02972dd0dc'::UUID))
);
CREATE TABLE public.phase10_terminal_retry_outcomes (
  extraction_id UUID PRIMARY KEY REFERENCES public.phase10_terminal_retry_audit(extraction_id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  extraction_after JSONB NOT NULL
);
ALTER TABLE public.phase10_terminal_retry_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phase10_terminal_retry_outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phase10_terminal_retry_audit, public.phase10_terminal_retry_outcomes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.phase10_terminal_retry_audit, public.phase10_terminal_retry_outcomes TO service_role;
CREATE POLICY phase10_audit_read ON public.phase10_terminal_retry_audit FOR SELECT TO service_role USING (true);
CREATE POLICY phase10_outcome_read ON public.phase10_terminal_retry_outcomes FOR SELECT TO service_role USING (true);

CREATE FUNCTION public.phase10_retry_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN RAISE EXCEPTION 'immutable Phase 10 audit'; END $$;
CREATE TRIGGER phase10_audit_immutable BEFORE UPDATE OR DELETE ON public.phase10_terminal_retry_audit
FOR EACH ROW EXECUTE FUNCTION public.phase10_retry_immutable();
CREATE TRIGGER phase10_outcome_immutable BEFORE UPDATE OR DELETE ON public.phase10_terminal_retry_outcomes
FOR EACH ROW EXECUTE FUNCTION public.phase10_retry_immutable();

CREATE FUNCTION public.claim_phase10_terminal_retry(p_source_id UUID, p_source_fingerprint TEXT,
  p_extractor_version TEXT, p_source_before JSONB, p_extraction_before JSONB, p_claim_token UUID)
RETURNS public.source_extractions LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE s public.sources; x public.source_extractions;
BEGIN
  IF p_source_id IS NULL OR p_source_id NOT IN (
    '0f73eba4-daa0-48ca-82a8-a4ae02284793'::UUID, '2d9a28eb-a142-4bc2-b694-530d141e0cbc'::UUID,
    '8f0d3c75-a084-410c-8d1b-0800655cec21'::UUID, 'b025846e-1928-4ac9-95dd-cf02972dd0dc'::UUID)
    OR p_source_fingerprint IS NULL OR p_source_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_extractor_version IS DISTINCT FROM 'phase6-v1' OR p_claim_token IS NULL
    OR p_source_before IS NULL OR p_extraction_before IS NULL THEN
    RAISE EXCEPTION 'invalid Phase 10 authorization';
  END IF;
  -- Match persistence lock order. Concurrent authorizations serialize here.
  SELECT * INTO s FROM public.sources WHERE id = p_source_id FOR UPDATE;
  IF NOT FOUND OR to_jsonb(s) IS DISTINCT FROM p_source_before
    OR s.content_fingerprint IS DISTINCT FROM p_source_fingerprint
    OR s.is_current IS DISTINCT FROM true OR s.status IS NULL OR s.status NOT IN ('active','updated','postponed')
    OR NULLIF(btrim(COALESCE(s.normalized_text, s.raw_text)), '') IS NULL
    OR s.platform IS DISTINCT FROM 'facebook'
    OR s.post_id IS NULL OR s.post_id !~ '^[0-9]+$'
    OR s.post_url IS NULL OR s.post_url !~ ('^https://www[.]facebook[.]com/Buglasan/posts/([^/?#]+/)?' || s.post_id || '/?$')
    OR s.collection_method IS NULL OR s.collection_method NOT IN ('manual','meta_graph_api','admin_export')
    OR s.source_metadata IS NULL OR s.source_metadata::TEXT ~* '(synthetic|fixture|acceptance|smoke|test)'
    OR NULLIF(btrim(s.source_metadata #>> '{provenance,operator}'), '') IS NULL
    OR NULLIF(btrim(s.source_metadata #>> '{provenance,reviewed_at}'), '') IS NULL
    OR NULLIF(btrim(s.source_metadata #>> '{provenance,capture_note}'), '') IS NULL THEN
    RAISE EXCEPTION 'changed or ineligible Phase 10 source';
  END IF;
  SELECT * INTO x FROM public.source_extractions WHERE source_id = p_source_id
    AND source_fingerprint = p_source_fingerprint AND extractor_version = p_extractor_version FOR UPDATE;
  IF NOT FOUND OR to_jsonb(x) IS DISTINCT FROM p_extraction_before
    OR x.status IS DISTINCT FROM 'permanent_error' OR x.attempt_count IS DISTINCT FROM 4
    OR x.last_error_code IS DISTINCT FROM 'extraction_failed'
    OR x.claim_token IS NOT NULL OR x.lease_expires_at IS NOT NULL THEN
    RAISE EXCEPTION 'changed or ineligible Phase 10 extraction';
  END IF;
  -- Refuse ALL existing source-local candidates/links, including stale fingerprints.
  IF EXISTS (SELECT 1 FROM public.events WHERE extracted_source_id = p_source_id)
    OR EXISTS (SELECT 1 FROM public.event_sources WHERE source_id = p_source_id) THEN
    RAISE EXCEPTION 'preexisting Phase 10 candidate evidence';
  END IF;
  INSERT INTO public.phase10_terminal_retry_audit
    (source_id, source_fingerprint, extractor_version, extraction_id, claim_token, source_before, extraction_before)
  VALUES (p_source_id, p_source_fingerprint, p_extractor_version, x.id, p_claim_token, to_jsonb(s), to_jsonb(x));
  UPDATE public.source_extractions SET status = 'processing', attempt_count = 5,
    claim_token = p_claim_token, lease_expires_at = clock_timestamp() + interval '60 seconds',
    started_at = clock_timestamp(), completed_at = NULL
    -- Keep previous errors/results until persistence/failure; immutable audit retains them afterwards.
  WHERE id = x.id RETURNING * INTO x;
  RETURN x;
END $$;

-- Fence legacy failure and claim paths without changing unrelated tuples.
CREATE FUNCTION public.phase10_retry_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE a public.phase10_terminal_retry_audit;
BEGIN
  SELECT * INTO a FROM public.phase10_terminal_retry_audit WHERE extraction_id = OLD.id;
  IF NOT FOUND THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'permanent Phase 10 tuple fence'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.source_id IS DISTINCT FROM OLD.source_id
    OR NEW.source_fingerprint IS DISTINCT FROM OLD.source_fingerprint
    OR NEW.extractor_version IS DISTINCT FROM OLD.extractor_version THEN
    RAISE EXCEPTION 'permanent Phase 10 tuple identity';
  END IF;
  IF OLD.attempt_count = 4 AND OLD.status = 'permanent_error' AND NEW.status = 'processing'
    AND NEW.attempt_count = 5 AND NEW.claim_token = a.claim_token
    AND to_jsonb(OLD) = a.extraction_before THEN RETURN NEW; END IF;
  IF OLD.status <> 'processing' OR NEW.status NOT IN ('extracted','no_event','needs_review','retryable_error','permanent_error')
    OR NEW.attempt_count <> 5 OR NEW.claim_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL THEN
    RAISE EXCEPTION 'consumed Phase 10 claim';
  END IF;
  -- A transient failure is terminal for this one-shot tuple; no recovery attempt six.
  IF NEW.status = 'retryable_error' THEN NEW.status := 'permanent_error'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER phase10_retry_fence BEFORE UPDATE OR DELETE ON public.source_extractions
FOR EACH ROW EXECUTE FUNCTION public.phase10_retry_fence();

CREATE FUNCTION public.phase10_retry_record_outcome() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status <> 'processing' AND EXISTS (SELECT 1 FROM public.phase10_terminal_retry_audit WHERE extraction_id = NEW.id) THEN
    INSERT INTO public.phase10_terminal_retry_outcomes(extraction_id, extraction_after) VALUES (NEW.id, to_jsonb(NEW));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER phase10_retry_outcome AFTER UPDATE ON public.source_extractions
FOR EACH ROW EXECUTE FUNCTION public.phase10_retry_record_outcome();

-- Same legacy contract except fenced tuples never return executable ownership,
-- even with a repeated token or an expired lease. No generic reset API.
CREATE OR REPLACE FUNCTION public.claim_source_extraction(
  p_source_id UUID, p_source_fingerprint TEXT, p_extractor_version TEXT,
  p_claim_token UUID, p_lease_seconds INTEGER DEFAULT 60
) RETURNS public.source_extractions LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE v_row public.source_extractions;
BEGIN
  IF p_claim_token IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 300 THEN RAISE EXCEPTION 'invalid extraction lease'; END IF;
  INSERT INTO public.source_extractions (source_id, source_fingerprint, extractor_version, status)
  VALUES (p_source_id, p_source_fingerprint, p_extractor_version, 'pending')
  ON CONFLICT (source_id, source_fingerprint, extractor_version) DO NOTHING;
  SELECT * INTO v_row FROM public.source_extractions
  WHERE source_id = p_source_id AND source_fingerprint = p_source_fingerprint AND extractor_version = p_extractor_version FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.phase10_terminal_retry_audit
    WHERE (source_id = p_source_id AND source_fingerprint = p_source_fingerprint
      AND extractor_version = p_extractor_version) AND extraction_id <> v_row.id) THEN
    -- Fail closed and roll back any pending insert if privileged maintenance
    -- replaced the original row. A new row ID never resets tuple consumption.
    RAISE EXCEPTION 'consumed Phase 10 tuple has changed extraction identity';
  END IF;
  IF EXISTS (SELECT 1 FROM public.phase10_terminal_retry_audit
    WHERE extraction_id = v_row.id OR (source_id = p_source_id
      AND source_fingerprint = p_source_fingerprint AND extractor_version = p_extractor_version)) THEN
    v_row.claim_token := NULL; v_row.lease_expires_at := NULL; RETURN v_row;
  END IF;
  IF v_row.status IN ('extracted','no_event','needs_review','permanent_error') THEN RETURN v_row; END IF;
  IF v_row.status = 'processing' AND v_row.lease_expires_at > clock_timestamp() THEN RETURN v_row; END IF;
  UPDATE public.source_extractions SET status = 'processing', attempt_count = attempt_count + 1,
    claim_token = p_claim_token, lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
    started_at = clock_timestamp(), completed_at = NULL, last_error_code = NULL, last_error_message = NULL
  WHERE id = v_row.id RETURNING * INTO v_row;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.claim_phase10_terminal_retry(UUID,TEXT,TEXT,JSONB,JSONB,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_phase10_terminal_retry(UUID,TEXT,TEXT,JSONB,JSONB,UUID) TO service_role;
REVOKE ALL ON FUNCTION public.phase10_retry_immutable(), public.phase10_retry_fence(), public.phase10_retry_record_outcome() FROM PUBLIC, anon, authenticated, service_role;
