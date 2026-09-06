-- Phase 8.1 acceptance-only escape hatch. Normal reconciliation history remains
-- append-only; the trusted Edge Function authenticates the acceptance token before
-- calling this service-role-only, exact-fixture RPC.
CREATE OR REPLACE FUNCTION public.reconciliation_prevent_mutation() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF current_setting('app.reconciliation_acceptance_cleanup', true) = 'on' THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  IF TG_TABLE_NAME = 'canonical_event_versions' AND TG_OP = 'UPDATE'
     AND NEW.superseded_at IS NOT NULL AND OLD.superseded_at IS NULL
     AND NEW.id = OLD.id AND NEW.canonical_event_id = OLD.canonical_event_id
     AND NEW.festival_year = OLD.festival_year AND NEW.version_number = OLD.version_number
     AND NEW.event_name IS NOT DISTINCT FROM OLD.event_name AND NEW.aliases IS NOT DISTINCT FROM OLD.aliases
     AND NEW.description IS NOT DISTINCT FROM OLD.description AND NEW.category IS NOT DISTINCT FROM OLD.category
     AND NEW.start_datetime IS NOT DISTINCT FROM OLD.start_datetime AND NEW.end_datetime IS NOT DISTINCT FROM OLD.end_datetime
     AND NEW.venue IS NOT DISTINCT FROM OLD.venue AND NEW.organizer IS NOT DISTINCT FROM OLD.organizer
     AND NEW.deadline IS NOT DISTINCT FROM OLD.deadline AND NEW.eligibility IS NOT DISTINCT FROM OLD.eligibility
     AND NEW.fees IS NOT DISTINCT FROM OLD.fees AND NEW.contact_info IS NOT DISTINCT FROM OLD.contact_info
     AND NEW.status = OLD.status AND NEW.change_kind = OLD.change_kind AND NEW.reconciliation_run_id IS NOT DISTINCT FROM OLD.reconciliation_run_id
     AND NEW.published_at = OLD.published_at THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'reconciliation history is append-only';
END $$;

CREATE OR REPLACE FUNCTION public.cleanup_reconciliation_acceptance_fixtures(p_fixture_ids TEXT[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE ids TEXT[]; source_ids UUID[]; candidate_ids UUID[]; run_ids UUID[]; canonical_ids UUID[]; bad_count INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  ids := ARRAY(SELECT DISTINCT unnest(p_fixture_ids) ORDER BY 1);
  IF p_fixture_ids IS NULL OR cardinality(p_fixture_ids) <> 12 OR cardinality(ids) <> 12
     OR ids <> ARRAY['reconciliation-test-01-create', 'reconciliation-test-02-identical', 'reconciliation-test-03-reschedule', 'reconciliation-test-04-cancellation', 'reconciliation-test-05-conflicting-date', 'reconciliation-test-06-distinct', 'reconciliation-test-07-registration-extension', 'reconciliation-test-08-venue-change', 'reconciliation-test-09-postponement', 'reconciliation-test-10-new-schedule', 'reconciliation-test-11-null-year', 'reconciliation-test-12-replay']::TEXT[] THEN RAISE EXCEPTION 'invalid fixture ids'; END IF;
  SELECT array_agg(id) INTO source_ids FROM public.sources WHERE post_id = ANY(ids);
  IF source_ids IS NULL THEN RETURN jsonb_build_object('deleted_sources', 0); END IF;
  IF EXISTS (SELECT 1 FROM public.sources WHERE id = ANY(source_ids) AND post_id <> ALL(ids)) THEN RAISE EXCEPTION 'nonfixture source scope'; END IF;
  SELECT array_agg(id) INTO candidate_ids FROM public.events WHERE extracted_source_id = ANY(source_ids);
  SELECT array_agg(id), array_agg(DISTINCT canonical_event_id) FILTER (WHERE canonical_event_id IS NOT NULL) INTO run_ids, canonical_ids FROM public.event_reconciliation_runs WHERE candidate_source_id = ANY(source_ids);
  SELECT count(*) INTO bad_count FROM public.event_reconciliation_runs r WHERE r.canonical_event_id = ANY(COALESCE(canonical_ids, '{}'::uuid[])) AND r.candidate_source_id <> ALL(source_ids);
  IF bad_count <> 0 THEN RAISE EXCEPTION 'refusing shared canonical graph'; END IF;
  PERFORM set_config('app.reconciliation_acceptance_cleanup', 'on', true);
  DELETE FROM public.event_reconciliation_reviews WHERE run_id = ANY(COALESCE(run_ids, '{}'::uuid[]));
  DELETE FROM public.event_reconciliation_audit WHERE run_id = ANY(COALESCE(run_ids, '{}'::uuid[]));
  DELETE FROM public.event_candidate_associations WHERE reconciliation_run_id = ANY(COALESCE(run_ids, '{}'::uuid[]));
  DELETE FROM public.canonical_event_field_history WHERE reconciliation_run_id = ANY(COALESCE(run_ids, '{}'::uuid[]));
  UPDATE public.canonical_events SET current_version_id = NULL WHERE id = ANY(COALESCE(canonical_ids, '{}'::uuid[]));
  UPDATE public.event_reconciliation_runs SET canonical_event_version_id = NULL, canonical_event_id = NULL WHERE id = ANY(COALESCE(run_ids, '{}'::uuid[]));
  DELETE FROM public.canonical_event_versions WHERE canonical_event_id = ANY(COALESCE(canonical_ids, '{}'::uuid[]));
  DELETE FROM public.canonical_events WHERE id = ANY(COALESCE(canonical_ids, '{}'::uuid[]));
  DELETE FROM public.event_reconciliation_runs WHERE id = ANY(COALESCE(run_ids, '{}'::uuid[]));
  DELETE FROM public.events WHERE extracted_source_id = ANY(source_ids);
  DELETE FROM public.sources WHERE id = ANY(source_ids);
  RETURN jsonb_build_object('deleted_sources', cardinality(source_ids));
END $$;

REVOKE ALL ON FUNCTION public.cleanup_reconciliation_acceptance_fixtures(TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_reconciliation_acceptance_fixtures(TEXT[]) TO service_role;
