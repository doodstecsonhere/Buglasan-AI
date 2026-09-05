-- Phase 5.1 forward fix: derive post_year in the Asia/Manila civil timezone.
-- Migrations 001-004 are immutable; the complete function is restated to preserve every guarantee.

CREATE OR REPLACE FUNCTION public.ingest_source(p_payload JSONB)
RETURNS TABLE (source_id UUID, post_id TEXT, operation TEXT, changed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET timezone = 'UTC'
AS $$
DECLARE
  v_platform TEXT;
  v_post_id TEXT;
  v_post_url TEXT;
  v_published_at TIMESTAMPTZ;
  v_post_year INTEGER;
  v_festival_year INTEGER;
  v_raw_text TEXT;
  v_normalized_text TEXT;
  v_title TEXT;
  v_source_type TEXT;
  v_media_urls TEXT[];
  v_collected_at TIMESTAMPTZ;
  v_collection_method TEXT;
  v_source_metadata JSONB;
  v_fingerprint TEXT;
  v_existing public.sources%ROWTYPE;
  v_keys CONSTANT TEXT[] := ARRAY[
    'platform','post_id','post_url','published_at','post_year','festival_year','raw_text',
    'normalized_text','title','source_type','media_urls','collected_at','collection_method','source_metadata'
  ];
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'payload must be a JSON object';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) AS supplied(key) WHERE NOT (supplied.key = ANY(v_keys)))
     OR EXISTS (SELECT 1 FROM unnest(v_keys) AS expected(key) WHERE NOT p_payload ? expected.key) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'payload contains unknown or missing fields';
  END IF;

  v_platform := p_payload->>'platform';
  v_post_id := btrim(p_payload->>'post_id');
  v_post_url := btrim(p_payload->>'post_url');
  IF v_platform IS DISTINCT FROM 'facebook' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'platform must be facebook'; END IF;
  IF v_post_id IS NULL OR v_post_id = '' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'post_id must be non-empty'; END IF;
  IF v_post_url IS NULL OR v_post_url !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'post_url must be HTTP(S)'; END IF;

  BEGIN
    v_published_at := CASE WHEN jsonb_typeof(p_payload->'published_at') = 'null' THEN NULL ELSE (p_payload->>'published_at')::TIMESTAMPTZ END;
    v_collected_at := (p_payload->>'collected_at')::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22007', MESSAGE = 'published_at/collected_at must be valid timestamps';
  END;
  IF v_collected_at IS NULL OR p_payload->>'collected_at' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' THEN
    RAISE EXCEPTION USING ERRCODE = '22007', MESSAGE = 'collected_at must include a timezone';
  END IF;
  IF v_published_at IS NOT NULL AND p_payload->>'published_at' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' THEN
    RAISE EXCEPTION USING ERRCODE = '22007', MESSAGE = 'published_at must include a timezone';
  END IF;

  BEGIN
    IF jsonb_typeof(p_payload->'post_year') NOT IN ('number', 'null') OR jsonb_typeof(p_payload->'festival_year') NOT IN ('number', 'null') THEN
      RAISE EXCEPTION 'bad year type';
    END IF;
    IF jsonb_typeof(p_payload->'post_year') = 'number' AND p_payload->>'post_year' !~ '^-?[0-9]+$' THEN RAISE EXCEPTION 'bad year value'; END IF;
    IF jsonb_typeof(p_payload->'festival_year') = 'number' AND p_payload->>'festival_year' !~ '^-?[0-9]+$' THEN RAISE EXCEPTION 'bad year value'; END IF;
    v_post_year := CASE WHEN jsonb_typeof(p_payload->'post_year') = 'null' THEN NULL ELSE (p_payload->>'post_year')::INTEGER END;
    v_festival_year := CASE WHEN jsonb_typeof(p_payload->'festival_year') = 'null' THEN NULL ELSE (p_payload->>'festival_year')::INTEGER END;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'years must be nullable integers';
  END;
  IF v_post_year IS NOT NULL AND v_post_year NOT BETWEEN 1900 AND 2100 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'post_year out of range'; END IF;
  IF v_festival_year IS NOT NULL AND v_festival_year NOT BETWEEN 1900 AND 2100 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'festival_year out of range'; END IF;
  IF v_published_at IS NOT NULL THEN v_post_year := EXTRACT(YEAR FROM v_published_at AT TIME ZONE 'Asia/Manila')::INTEGER; END IF;

  IF jsonb_typeof(p_payload->'raw_text') NOT IN ('string', 'null')
     OR jsonb_typeof(p_payload->'normalized_text') NOT IN ('string', 'null')
     OR jsonb_typeof(p_payload->'title') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'text fields must be strings or null';
  END IF;
  v_raw_text := p_payload->>'raw_text';
  v_normalized_text := p_payload->>'normalized_text';
  v_title := p_payload->>'title';
  v_source_type := p_payload->>'source_type';
  v_collection_method := p_payload->>'collection_method';
  IF v_source_type NOT IN ('text','image','video','link','mixed','unknown') THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid source_type'; END IF;
  IF v_collection_method NOT IN ('manual','meta_graph_api','admin_export','other') THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid collection_method'; END IF;

  IF jsonb_typeof(p_payload->'media_urls') <> 'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'media_urls') value WHERE jsonb_typeof(value) <> 'string' OR value#>>'{}' !~* '^https?://[^[:space:]]+$') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'media_urls must contain only HTTP(S) URLs';
  END IF;
  SELECT COALESCE(array_agg(value ORDER BY ordinal), '{}'::TEXT[]) INTO v_media_urls
  FROM jsonb_array_elements_text(p_payload->'media_urls') WITH ORDINALITY AS media(value, ordinal);
  v_source_metadata := p_payload->'source_metadata';
  IF jsonb_typeof(v_source_metadata) <> 'object' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'source_metadata must be an object'; END IF;
  IF v_raw_text IS NULL AND v_normalized_text IS NULL AND cardinality(v_media_urls) = 0 AND v_source_metadata = '{}'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'text-null source requires media or provenance';
  END IF;
  IF v_source_type = 'text' AND v_raw_text IS NULL AND v_normalized_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'text source requires text';
  END IF;

  -- jsonb::text canonicalizes object keys while preserving array/media order.
  v_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'platform', v_platform, 'post_id', v_post_id, 'post_url', v_post_url,
    'published_at', v_published_at, 'post_year', v_post_year, 'festival_year', v_festival_year,
    'raw_text', v_raw_text, 'normalized_text', v_normalized_text, 'title', v_title,
    'source_type', v_source_type, 'media_urls', to_jsonb(v_media_urls),
    'collection_method', v_collection_method, 'source_metadata', v_source_metadata
   )::TEXT, 'UTF8'), 'sha256'::text), 'hex');

  -- The unique-key row lock serializes competing edits. If absent, INSERT may race;
  -- unique_violation retries via the lock path without creating a duplicate.
  LOOP
    SELECT * INTO v_existing FROM public.sources s
    WHERE s.platform = v_platform AND s.post_id = v_post_id FOR UPDATE;
    IF FOUND THEN
      IF v_existing.content_fingerprint IS NOT DISTINCT FROM v_fingerprint THEN
        RETURN QUERY SELECT v_existing.id, v_post_id, 'unchanged'::TEXT, FALSE;
      ELSE
        UPDATE public.sources s SET
          post_url = v_post_url, published_at = v_published_at, post_year = v_post_year,
          festival_year = v_festival_year, raw_text = v_raw_text, normalized_text = v_normalized_text,
          title = v_title, source_type = v_source_type, media_urls = v_media_urls,
          collected_at = v_collected_at, collection_method = v_collection_method,
          source_metadata = v_source_metadata, content_fingerprint = v_fingerprint, updated_at = clock_timestamp()
        WHERE s.id = v_existing.id;
        RETURN QUERY SELECT v_existing.id, v_post_id, 'updated'::TEXT, TRUE;
      END IF;
      RETURN;
    END IF;
    BEGIN
      INSERT INTO public.sources (
        platform, post_id, post_url, published_at, post_year, festival_year, raw_text,
        normalized_text, title, source_type, media_urls, collected_at, collection_method,
        source_metadata, content_fingerprint
      ) VALUES (
        v_platform, v_post_id, v_post_url, v_published_at, v_post_year, v_festival_year, v_raw_text,
        v_normalized_text, v_title, v_source_type, v_media_urls, v_collected_at, v_collection_method,
        v_source_metadata, v_fingerprint
      ) RETURNING id INTO source_id;
      RETURN QUERY SELECT source_id, v_post_id, 'inserted'::TEXT, TRUE;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      -- Concurrent winner committed first; loop and compare under row lock.
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_source(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ingest_source(JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_source(JSONB) TO service_role;

COMMENT ON FUNCTION public.ingest_source(JSONB) IS
  'Service-role-only atomic source collector. No chunks, embeddings, events, OCR, extraction, or supersession.';
