-- Phase 6 live-acceptance forward fix: extracted event audit rows need an
-- independently writable current marker. Migration 002 made this generated
-- from status, which prevents source-local replacement from retaining an old
-- event status while marking that old fingerprint non-current.
ALTER TABLE public.events
  ALTER COLUMN is_current DROP EXPRESSION;

ALTER TABLE public.events
  ALTER COLUMN is_current SET DEFAULT TRUE;

COMMENT ON COLUMN public.events.is_current IS
  'Retrieval-current marker. Independently false for prior extraction fingerprints retained as audit rows.';
