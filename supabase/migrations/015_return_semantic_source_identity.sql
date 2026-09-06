-- Semantic retrieval citations require source identity, not only chunk text.
--
-- PostgreSQL does not allow CREATE OR REPLACE FUNCTION to change a function's
-- OUT-parameter row type. Migration 009 created this function without the two
-- source identity columns, so a plain CREATE OR REPLACE fails during deploy.
-- The chat and seed callers use this as an RPC only; nevertheless, refuse to
-- drop it if a database object has acquired a catalog dependency on it.
DO $$
DECLARE
  function_oid OID;
  dependent TEXT;
BEGIN
  SELECT p.oid INTO function_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'search_source_chunks'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'query_embedding extensions.vector, target_festival_year integer, match_threshold double precision, match_count integer';

  IF function_oid IS NOT NULL THEN
    SELECT pg_catalog.pg_describe_object(d.classid, d.objid, d.objsubid)
    INTO dependent
    FROM pg_catalog.pg_depend d
    WHERE d.refclassid = 'pg_catalog.pg_proc'::regclass
      AND d.refobjid = function_oid
      AND d.deptype = 'n'
    LIMIT 1;

    IF dependent IS NOT NULL THEN
      RAISE EXCEPTION 'cannot replace search_source_chunks: dependent object exists: %', dependent;
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.search_source_chunks(extensions.vector(768), INT, FLOAT, INT);

CREATE FUNCTION public.search_source_chunks(
  query_embedding extensions.vector(768),
  target_festival_year INT,
  match_threshold FLOAT DEFAULT .7,
  match_count INT DEFAULT 10
)
RETURNS TABLE(
  chunk_id UUID,
  source_id UUID,
  chunk_index INT,
  content TEXT,
  similarity FLOAT,
  source_platform TEXT,
  source_post_id TEXT,
  source_post_url TEXT,
  source_published_at TIMESTAMPTZ,
  source_festival_year INT,
  source_status TEXT,
  source_supersedes_source_id UUID
)
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path=pg_catalog,public,extensions
AS $$
  SELECT
    sc.id,
    sc.source_id,
    sc.chunk_index,
    sc.content,
    1 - (sc.embedding OPERATOR(extensions.<=>) query_embedding),
    s.platform,
    s.post_id,
    s.post_url,
    s.published_at,
    s.festival_year,
    s.status,
    s.supersedes_source_id
  FROM public.source_chunks sc
  JOIN public.sources s ON s.id = sc.source_id
  WHERE sc.is_current
    AND sc.embedding IS NOT NULL
    AND s.is_current
    AND s.festival_year = target_festival_year
    AND s.status IN ('active', 'updated', 'postponed')
    AND 1 - (sc.embedding OPERATOR(extensions.<=>) query_embedding) > match_threshold
  ORDER BY sc.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count
$$;
