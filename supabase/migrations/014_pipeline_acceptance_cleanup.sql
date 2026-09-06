-- Phase 9 acceptance-only cleanup. This is deliberately separate from frozen Phase 8
-- cleanup and accepts one immutable pipeline fixture set only.
CREATE OR REPLACE FUNCTION public.cleanup_pipeline_acceptance_fixtures()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE
  ids CONSTANT TEXT[] := ARRAY[
    'pipeline-test-01-current','pipeline-test-02-edit','pipeline-test-03-replay','pipeline-test-04-cancelled',
    'pipeline-test-05-no-event','pipeline-test-06-textless','pipeline-test-07-null-year','pipeline-test-08-ambiguity',
    'pipeline-test-09-failure-isolation','pipeline-test-10-canonical','pipeline-test-batch-a','pipeline-test-batch-b','pipeline-test-batch-c'
  ];
  source_ids UUID[]; candidate_ids UUID[]; run_ids UUID[]; canonical_ids UUID[]; version_ids UUID[];
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  SELECT array_agg(s.id ORDER BY s.post_id) INTO source_ids FROM public.sources s
  WHERE s.post_id = ANY(ids);
  IF source_ids IS NULL THEN RETURN jsonb_build_object('deleted_sources', 0); END IF;
  IF EXISTS (
    SELECT 1 FROM public.sources s
    WHERE s.id = ANY(source_ids)
      AND (s.post_id <> ALL(ids) OR s.source_metadata->>'pipeline_acceptance_fixture' <> 'phase9-v1')
  ) THEN RAISE EXCEPTION 'nonfixture source scope'; END IF;
  SELECT array_agg(e.id) INTO candidate_ids FROM public.events e WHERE e.extracted_source_id = ANY(source_ids);
  SELECT array_agg(r.id), array_agg(DISTINCT r.canonical_event_id) FILTER (WHERE r.canonical_event_id IS NOT NULL)
  INTO run_ids, canonical_ids FROM public.event_reconciliation_runs r WHERE r.candidate_source_id = ANY(source_ids);
  SELECT array_agg(v.id) INTO version_ids FROM public.canonical_event_versions v WHERE v.canonical_event_id = ANY(COALESCE(canonical_ids, '{}'::uuid[]));
  IF EXISTS (
    SELECT 1 FROM public.event_reconciliation_runs r WHERE r.canonical_event_id = ANY(COALESCE(canonical_ids, '{}'::uuid[])) AND (r.candidate_source_id <> ALL(source_ids) OR r.candidate_event_id <> ALL(COALESCE(candidate_ids, '{}'::uuid[])))
    UNION ALL SELECT 1 FROM public.event_candidate_associations a WHERE a.canonical_event_id = ANY(COALESCE(canonical_ids, '{}'::uuid[])) AND (a.reconciliation_run_id <> ALL(COALESCE(run_ids, '{}'::uuid[])) OR a.candidate_event_id <> ALL(COALESCE(candidate_ids, '{}'::uuid[])))
    UNION ALL SELECT 1 FROM public.canonical_event_versions v WHERE v.canonical_event_id = ANY(COALESCE(canonical_ids, '{}'::uuid[])) AND v.reconciliation_run_id <> ALL(COALESCE(run_ids, '{}'::uuid[]))
    UNION ALL SELECT 1 FROM public.canonical_event_field_history h WHERE h.canonical_event_version_id = ANY(COALESCE(version_ids, '{}'::uuid[])) AND (h.reconciliation_run_id <> ALL(COALESCE(run_ids, '{}'::uuid[])) OR h.source_id <> ALL(source_ids) OR h.candidate_event_id <> ALL(COALESCE(candidate_ids, '{}'::uuid[])))
    UNION ALL SELECT 1 FROM public.canonical_events c WHERE c.id = ANY(COALESCE(canonical_ids, '{}'::uuid[])) AND c.current_version_id <> ALL(COALESCE(version_ids, '{}'::uuid[]))
  ) THEN RAISE EXCEPTION 'refusing shared canonical graph'; END IF;
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
  DELETE FROM public.source_chunks WHERE source_id = ANY(source_ids);
  DELETE FROM public.source_indexings WHERE source_id = ANY(source_ids);
  DELETE FROM public.events WHERE extracted_source_id = ANY(source_ids);
  DELETE FROM public.sources WHERE id = ANY(source_ids);
  RETURN jsonb_build_object('deleted_sources', cardinality(source_ids));
END $$;

REVOKE ALL ON FUNCTION public.cleanup_pipeline_acceptance_fixtures() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_pipeline_acceptance_fixtures() TO service_role;
