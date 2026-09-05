-- Phase 6 forward fix: migration 007 made events.is_current writable so old
-- extraction fingerprints can remain as inactive audit rows. Restore canonical
-- status synchronization without reactivating stale extraction fingerprints.
CREATE OR REPLACE FUNCTION public.sync_event_is_current()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_source_fingerprint TEXT;
BEGIN
  IF NEW.extracted_source_id IS NOT NULL THEN
    SELECT content_fingerprint INTO v_source_fingerprint
    FROM public.sources
    WHERE id = NEW.extracted_source_id;
  END IF;

  NEW.is_current := NEW.status IN ('scheduled', 'confirmed')
    AND (
      NEW.extracted_source_id IS NULL
      OR NEW.source_fingerprint IS NOT DISTINCT FROM v_source_fingerprint
    );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_event_is_current_from_status ON public.events;
CREATE TRIGGER sync_event_is_current_from_status
  BEFORE INSERT OR UPDATE OF status ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.sync_event_is_current();

-- Normalize rows created after migration 007 and before this forward fix.
UPDATE public.events e
SET is_current = (
  e.status IN ('scheduled', 'confirmed')
  AND (
    e.extracted_source_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.sources s
      WHERE s.id = e.extracted_source_id
        AND s.content_fingerprint IS NOT DISTINCT FROM e.source_fingerprint
    )
  )
);

REVOKE ALL ON FUNCTION public.sync_event_is_current() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_event_is_current() TO service_role;

COMMENT ON FUNCTION public.sync_event_is_current() IS
  'Synchronizes retrieval-current event state with canonical status while preserving stale extraction fingerprints as inactive audit rows.';
