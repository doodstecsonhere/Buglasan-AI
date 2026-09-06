-- Phase 7: audited, lease-owned, atomic semantic indexing.
CREATE TABLE public.source_indexings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), source_id UUID NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  source_fingerprint TEXT NOT NULL CHECK (btrim(source_fingerprint) <> ''), indexer_version TEXT NOT NULL CHECK (btrim(indexer_version) <> ''),
  embedding_model TEXT NOT NULL CHECK (btrim(embedding_model) <> ''), embedding_dimensions INTEGER NOT NULL CHECK (embedding_dimensions = 768),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','indexed','no_text','needs_review','retryable_error','permanent_error')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0), chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  review_reasons TEXT[] NOT NULL DEFAULT '{}'::TEXT[], last_error_code TEXT, last_error_message TEXT, claim_token UUID, lease_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT source_indexings_identity_unique UNIQUE(source_id,source_fingerprint,indexer_version),
  CONSTRAINT source_indexings_claim_shape CHECK ((status='processing' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR (status<>'processing' AND claim_token IS NULL AND lease_expires_at IS NULL)),
  CONSTRAINT source_indexings_terminal_shape CHECK ((status='indexed' AND chunk_count>0 AND cardinality(review_reasons)=0) OR (status='no_text' AND chunk_count=0 AND cardinality(review_reasons)=0) OR (status='needs_review' AND chunk_count=0 AND cardinality(review_reasons)>0) OR status IN ('pending','processing','retryable_error','permanent_error'))
);
CREATE INDEX idx_source_indexings_source_latest ON public.source_indexings(source_id,created_at DESC);
CREATE INDEX idx_source_indexings_status_updated ON public.source_indexings(status,updated_at);
CREATE INDEX idx_source_indexings_reclaimable ON public.source_indexings(lease_expires_at) WHERE status='processing';
CREATE TRIGGER update_source_indexings_updated_at BEFORE UPDATE ON public.source_indexings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.source_indexings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access for source_indexings" ON public.source_indexings FOR ALL USING (auth.role()='service_role') WITH CHECK(auth.role()='service_role');

ALTER TABLE public.source_chunks DROP CONSTRAINT IF EXISTS unique_source_chunk;
ALTER TABLE public.source_chunks ADD COLUMN source_fingerprint TEXT, ADD COLUMN indexer_version TEXT, ADD COLUMN embedding_model TEXT,
 ADD COLUMN embedding_dimensions INTEGER, ADD COLUMN content_hash TEXT, ADD COLUMN is_current BOOLEAN NOT NULL DEFAULT TRUE,
 ADD COLUMN superseded_at TIMESTAMPTZ, ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE public.source_chunks sc SET source_fingerprint=s.content_fingerprint,indexer_version='legacy-pre-phase7',embedding_model='gemini-embedding-001',embedding_dimensions=768,content_hash=encode(extensions.digest(sc.content,'sha256'),'hex') FROM public.sources s WHERE s.id=sc.source_id;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.source_chunks WHERE source_fingerprint IS NULL OR content_hash IS NULL) THEN RAISE EXCEPTION 'source_chunks provenance backfill failed'; END IF; END $$;
ALTER TABLE public.source_chunks ALTER COLUMN source_fingerprint SET NOT NULL, ALTER COLUMN indexer_version SET NOT NULL, ALTER COLUMN embedding_model SET NOT NULL,
 ALTER COLUMN embedding_dimensions SET NOT NULL, ALTER COLUMN content_hash SET NOT NULL,
 ADD CONSTRAINT source_chunks_chunk_index_nonnegative CHECK(chunk_index>=0), ADD CONSTRAINT source_chunks_content_nonempty CHECK(btrim(content)<>''),
 ADD CONSTRAINT source_chunks_fingerprint_nonempty CHECK(btrim(source_fingerprint)<>''), ADD CONSTRAINT source_chunks_indexer_version_nonempty CHECK(btrim(indexer_version)<>''),
 ADD CONSTRAINT source_chunks_embedding_model_nonempty CHECK(btrim(embedding_model)<>''), ADD CONSTRAINT source_chunks_embedding_dimensions_768 CHECK(embedding_dimensions=768),
 ADD CONSTRAINT source_chunks_content_hash_sha256 CHECK(content_hash~'^[0-9a-f]{64}$'), ADD CONSTRAINT source_chunks_current_shape CHECK((is_current AND superseded_at IS NULL) OR (NOT is_current AND superseded_at IS NOT NULL)),
 ADD CONSTRAINT source_chunks_identity_unique UNIQUE(source_id,source_fingerprint,indexer_version,chunk_index);
CREATE UNIQUE INDEX uq_source_chunks_one_current_position ON public.source_chunks(source_id,chunk_index) WHERE is_current;
CREATE INDEX idx_source_chunks_current_source ON public.source_chunks(source_id,is_current);
CREATE TRIGGER update_source_chunks_updated_at BEFORE UPDATE ON public.source_chunks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.claim_source_indexing(p_source_id UUID,p_source_fingerprint TEXT,p_indexer_version TEXT,p_embedding_model TEXT,p_embedding_dimensions INTEGER,p_claim_token UUID,p_lease_seconds INTEGER DEFAULT 120) RETURNS public.source_indexings LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE v public.source_indexings; BEGIN
 IF p_claim_token IS NULL OR p_lease_seconds<30 OR p_lease_seconds>300 OR NULLIF(btrim(p_source_fingerprint),'') IS NULL OR NULLIF(btrim(p_indexer_version),'') IS NULL OR NULLIF(btrim(p_embedding_model),'') IS NULL OR p_embedding_dimensions<>768 THEN RAISE EXCEPTION 'invalid indexing lease or configuration'; END IF;
 INSERT INTO public.source_indexings(source_id,source_fingerprint,indexer_version,embedding_model,embedding_dimensions) VALUES(p_source_id,p_source_fingerprint,p_indexer_version,p_embedding_model,p_embedding_dimensions) ON CONFLICT DO NOTHING;
 SELECT * INTO v FROM public.source_indexings WHERE source_id=p_source_id AND source_fingerprint=p_source_fingerprint AND indexer_version=p_indexer_version FOR UPDATE;
 IF v.embedding_model<>p_embedding_model OR v.embedding_dimensions<>p_embedding_dimensions THEN RAISE EXCEPTION 'indexer version configuration mismatch'; END IF;
 IF v.status IN ('indexed','no_text','needs_review','permanent_error') OR (v.status='processing' AND v.lease_expires_at>clock_timestamp()) THEN RETURN v; END IF;
 UPDATE public.source_indexings SET status='processing',attempt_count=attempt_count+1,chunk_count=0,review_reasons='{}',claim_token=p_claim_token,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),started_at=clock_timestamp(),completed_at=NULL,last_error_code=NULL,last_error_message=NULL WHERE id=v.id RETURNING * INTO v; RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.persist_source_indexing(p_indexing_id UUID,p_claim_token UUID,p_source_id UUID,p_source_fingerprint TEXT,p_indexer_version TEXT,p_embedding_model TEXT,p_embedding_dimensions INTEGER,p_status TEXT,p_chunks JSONB,p_review_reasons TEXT[] DEFAULT '{}'::TEXT[]) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions SET timezone='UTC' AS $$
DECLARE st public.source_indexings; src public.sources; c JSONB; ord BIGINT; idx INT; txt TEXT; hash TEXT; vec extensions.vector(768); expected UUID; n INT:=jsonb_array_length(COALESCE(p_chunks,'[]')); BEGIN
 IF p_status NOT IN('indexed','no_text','needs_review') OR jsonb_typeof(p_chunks)<>'array' THEN RAISE EXCEPTION 'invalid indexing result'; END IF;
 SELECT * INTO src FROM public.sources WHERE id=p_source_id FOR UPDATE; IF NOT FOUND OR src.content_fingerprint IS DISTINCT FROM p_source_fingerprint THEN RAISE EXCEPTION 'stale source fingerprint'; END IF;
 SELECT * INTO st FROM public.source_indexings WHERE id=p_indexing_id FOR UPDATE;
 IF NOT FOUND OR st.source_id<>p_source_id OR st.source_fingerprint<>p_source_fingerprint OR st.indexer_version<>p_indexer_version OR st.embedding_model<>p_embedding_model OR st.embedding_dimensions<>p_embedding_dimensions OR st.status<>'processing' OR st.claim_token IS DISTINCT FROM p_claim_token OR st.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'invalid or expired indexing claim'; END IF;
 IF (p_status='indexed' AND (n=0 OR cardinality(p_review_reasons)>0)) OR (p_status='no_text' AND (n<>0 OR cardinality(p_review_reasons)>0)) OR (p_status='needs_review' AND (n<>0 OR cardinality(p_review_reasons)=0)) THEN RAISE EXCEPTION 'invalid indexing terminal shape'; END IF;
 CREATE TEMP TABLE staged_index_chunks(id UUID,chunk_index INT,content TEXT,content_hash TEXT,embedding extensions.vector(768)) ON COMMIT DROP;
 FOR c,ord IN SELECT value,ordinality FROM jsonb_array_elements(p_chunks) WITH ORDINALITY LOOP
  BEGIN idx:=(c->>'chunk_index')::INT; txt:=c->>'content'; hash:=c->>'content_hash'; IF idx<>ord-1 THEN RAISE EXCEPTION 'non-contiguous chunk indexes'; END IF; IF NULLIF(btrim(txt),'') IS NULL OR hash!~'^[0-9a-f]{64}$' OR hash<>encode(extensions.digest(txt,'sha256'),'hex') THEN RAISE EXCEPTION 'invalid chunk content or hash'; END IF; IF jsonb_typeof(c->'embedding')<>'array' OR jsonb_array_length(c->'embedding')<>768 OR EXISTS(SELECT 1 FROM jsonb_array_elements(c->'embedding') e WHERE jsonb_typeof(e)<>'number') THEN RAISE EXCEPTION 'malformed embedding'; END IF; vec:=(c->'embedding')::TEXT::extensions.vector(768); IF abs(sqrt(-1*(vec OPERATOR(extensions.<#>) vec))-1)>0.00001 THEN RAISE EXCEPTION 'embedding is not normalized'; END IF; EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'malformed embedding'; END;
  expected:=extensions.uuid_generate_v5(extensions.uuid_ns_url(),p_source_id::TEXT||':'||p_source_fingerprint||':'||p_indexer_version||':'||idx); INSERT INTO staged_index_chunks VALUES(expected,idx,txt,hash,vec);
 END LOOP;
 IF EXISTS(
   SELECT 1 FROM staged_index_chunks staged
   JOIN public.source_chunks existing
     ON existing.source_id=p_source_id
    AND existing.source_fingerprint=p_source_fingerprint
    AND existing.indexer_version=p_indexer_version
    AND existing.chunk_index=staged.chunk_index
   WHERE existing.id<>staged.id OR existing.content<>staged.content OR existing.content_hash<>staged.content_hash
      OR existing.embedding_model<>p_embedding_model OR existing.embedding_dimensions<>p_embedding_dimensions
      OR existing.embedding<>staged.embedding
 ) THEN RAISE EXCEPTION 'non-deterministic indexing replay'; END IF;
 INSERT INTO public.source_chunks(id,source_id,chunk_index,content,embedding,source_fingerprint,indexer_version,embedding_model,embedding_dimensions,content_hash,is_current,superseded_at)
 SELECT id,p_source_id,chunk_index,content,embedding,p_source_fingerprint,p_indexer_version,p_embedding_model,p_embedding_dimensions,content_hash,FALSE,clock_timestamp() FROM staged_index_chunks
 ON CONFLICT(source_id,source_fingerprint,indexer_version,chunk_index) DO UPDATE SET updated_at=public.source_chunks.updated_at
 WHERE public.source_chunks.id=excluded.id AND public.source_chunks.content=excluded.content AND public.source_chunks.content_hash=excluded.content_hash AND public.source_chunks.embedding_model=excluded.embedding_model AND public.source_chunks.embedding_dimensions=excluded.embedding_dimensions AND public.source_chunks.embedding=excluded.embedding;
 IF p_status='indexed' AND (SELECT count(*) FROM public.source_chunks WHERE source_id=p_source_id AND source_fingerprint=p_source_fingerprint AND indexer_version=p_indexer_version)<>n THEN RAISE EXCEPTION 'non-deterministic indexing replay'; END IF;
 UPDATE public.source_chunks SET is_current=FALSE,superseded_at=clock_timestamp() WHERE source_id=p_source_id AND is_current;
 IF p_status='indexed' THEN UPDATE public.source_chunks SET is_current=TRUE,superseded_at=NULL WHERE source_id=p_source_id AND source_fingerprint=p_source_fingerprint AND indexer_version=p_indexer_version; END IF;
 UPDATE public.source_indexings SET status=p_status,chunk_count=n,review_reasons=p_review_reasons,completed_at=clock_timestamp(),claim_token=NULL,lease_expires_at=NULL,last_error_code=NULL,last_error_message=NULL WHERE id=p_indexing_id;
 RETURN jsonb_build_object('status',p_status,'persisted_chunks',n,'cached',FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.fail_source_indexing(p_indexing_id UUID,p_claim_token UUID,p_status TEXT,p_error_code TEXT,p_error_message TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' AS $$ BEGIN IF p_status NOT IN('retryable_error','permanent_error') THEN RAISE EXCEPTION 'invalid indexing error status'; END IF; UPDATE public.source_indexings SET status=p_status,last_error_code=left(COALESCE(p_error_code,'unknown'),100),last_error_message=left(COALESCE(p_error_message,'unknown indexing error'),2000),completed_at=clock_timestamp(),claim_token=NULL,lease_expires_at=NULL WHERE id=p_indexing_id AND status='processing' AND claim_token IS NOT DISTINCT FROM p_claim_token AND lease_expires_at>clock_timestamp(); IF NOT FOUND THEN RAISE EXCEPTION 'invalid or expired indexing claim'; END IF; END $$;

CREATE OR REPLACE FUNCTION public.search_source_chunks(query_embedding extensions.vector(768),target_festival_year INT,match_threshold FLOAT DEFAULT .7,match_count INT DEFAULT 10) RETURNS TABLE(chunk_id UUID,source_id UUID,chunk_index INT,content TEXT,similarity FLOAT,source_platform TEXT,source_published_at TIMESTAMPTZ,source_festival_year INT,source_status TEXT,source_supersedes_source_id UUID) LANGUAGE sql STABLE PARALLEL SAFE SET search_path=pg_catalog,public,extensions AS $$ SELECT sc.id,sc.source_id,sc.chunk_index,sc.content,1-(sc.embedding OPERATOR(extensions.<=>) query_embedding),s.platform,s.published_at,s.festival_year,s.status,s.supersedes_source_id FROM public.source_chunks sc JOIN public.sources s ON s.id=sc.source_id WHERE sc.is_current AND sc.embedding IS NOT NULL AND s.is_current AND s.festival_year=target_festival_year AND s.status IN('active','updated','postponed') AND 1-(sc.embedding OPERATOR(extensions.<=>) query_embedding)>match_threshold ORDER BY sc.embedding OPERATOR(extensions.<=>) query_embedding LIMIT match_count $$;
CREATE OR REPLACE VIEW public.indexing_review_queue WITH(security_invoker=true) AS SELECT i.id indexing_id,i.source_id,s.post_id,s.post_url,s.source_type,s.media_urls,s.festival_year,i.source_fingerprint,i.indexer_version,i.embedding_model,i.embedding_dimensions,i.status,i.review_reasons,i.attempt_count latest_attempt,i.last_error_code,i.last_error_message,i.created_at,i.updated_at FROM public.source_indexings i JOIN public.sources s ON s.id=i.source_id WHERE i.status IN('needs_review','retryable_error','permanent_error');
REVOKE ALL ON FUNCTION public.claim_source_indexing(UUID,TEXT,TEXT,TEXT,INTEGER,UUID,INTEGER), public.persist_source_indexing(UUID,UUID,UUID,TEXT,TEXT,TEXT,INTEGER,TEXT,JSONB,TEXT[]), public.fail_source_indexing(UUID,UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_source_indexing(UUID,TEXT,TEXT,TEXT,INTEGER,UUID,INTEGER), public.persist_source_indexing(UUID,UUID,UUID,TEXT,TEXT,TEXT,INTEGER,TEXT,JSONB,TEXT[]), public.fail_source_indexing(UUID,UUID,TEXT,TEXT,TEXT) TO service_role;
REVOKE ALL ON public.source_indexings,public.indexing_review_queue,public.source_chunks FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.source_indexings TO service_role; GRANT SELECT ON public.indexing_review_queue TO service_role;
