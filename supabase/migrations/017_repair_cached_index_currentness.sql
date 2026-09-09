-- Phase 10: an indexed audit row is cacheable only while its complete chunk
-- set is the source's current semantic representation.  Earlier deployments
-- could retain an indexed audit row after a currentness inversion, causing a
-- normal index-source replay to return cached without restoring retrieval.
CREATE OR REPLACE FUNCTION public.claim_source_indexing(p_source_id UUID,p_source_fingerprint TEXT,p_indexer_version TEXT,p_embedding_model TEXT,p_embedding_dimensions INTEGER,p_claim_token UUID,p_lease_seconds INTEGER DEFAULT 120) RETURNS public.source_indexings LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE v public.source_indexings; current_chunk_count INTEGER; BEGIN
 IF p_claim_token IS NULL OR p_lease_seconds<30 OR p_lease_seconds>300 OR NULLIF(btrim(p_source_fingerprint),'') IS NULL OR NULLIF(btrim(p_indexer_version),'') IS NULL OR NULLIF(btrim(p_embedding_model),'') IS NULL OR p_embedding_dimensions<>768 THEN RAISE EXCEPTION 'invalid indexing lease or configuration'; END IF;
 INSERT INTO public.source_indexings(source_id,source_fingerprint,indexer_version,embedding_model,embedding_dimensions) VALUES(p_source_id,p_source_fingerprint,p_indexer_version,p_embedding_model,p_embedding_dimensions) ON CONFLICT DO NOTHING;
 SELECT * INTO v FROM public.source_indexings WHERE source_id=p_source_id AND source_fingerprint=p_source_fingerprint AND indexer_version=p_indexer_version FOR UPDATE;
 IF v.embedding_model<>p_embedding_model OR v.embedding_dimensions<>p_embedding_dimensions THEN RAISE EXCEPTION 'indexer version configuration mismatch'; END IF;
 IF v.status='indexed' THEN
   SELECT count(*) INTO current_chunk_count FROM public.source_chunks
    WHERE source_id=p_source_id AND source_fingerprint=p_source_fingerprint
      AND indexer_version=p_indexer_version AND embedding_model=p_embedding_model
      AND embedding_dimensions=p_embedding_dimensions AND is_current;
   IF current_chunk_count=v.chunk_count AND current_chunk_count>0 THEN RETURN v; END IF;
 ELSIF v.status IN ('no_text','needs_review','permanent_error') OR (v.status='processing' AND v.lease_expires_at>clock_timestamp()) THEN RETURN v;
 END IF;
 UPDATE public.source_indexings SET status='processing',attempt_count=attempt_count+1,chunk_count=0,review_reasons='{}',claim_token=p_claim_token,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),started_at=clock_timestamp(),completed_at=NULL,last_error_code=NULL,last_error_message=NULL WHERE id=v.id RETURNING * INTO v;
 RETURN v;
END $$;
