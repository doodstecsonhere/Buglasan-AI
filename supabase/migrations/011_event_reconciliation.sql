-- Phase 8: canonical reconciliation. public.events remains the immutable Phase 6
-- source-local candidate ledger; events.is_current is candidate retrieval eligibility,
-- never canonical currentness, match acceptance, or review completion. Source
-- supersession remains independent evidence lineage.

CREATE TABLE public.canonical_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_year INTEGER NOT NULL,
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('scheduled','confirmed','postponed','cancelled','completed')),
  current_version_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, festival_year)
);

CREATE TABLE public.event_reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  reconciler_version TEXT NOT NULL CHECK (btrim(reconciler_version) <> ''),
  candidate_extraction_identity TEXT NOT NULL, candidate_source_id UUID NOT NULL REFERENCES public.sources(id) ON DELETE RESTRICT,
  candidate_source_fingerprint TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','reconciled','needs_review','retryable_error','permanent_error')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0), claim_token UUID, lease_expires_at TIMESTAMPTZ,
  input_hash TEXT, outcome_digest TEXT, selected_outcome TEXT, canonical_event_id UUID REFERENCES public.canonical_events(id) ON DELETE RESTRICT,
  canonical_event_version_id UUID, last_error_code TEXT, last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (candidate_event_id, reconciler_version),
  CHECK ((status = 'processing' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR (status <> 'processing' AND claim_token IS NULL AND lease_expires_at IS NULL))
);

CREATE TABLE public.canonical_event_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), canonical_event_id UUID NOT NULL REFERENCES public.canonical_events(id) ON DELETE RESTRICT,
  festival_year INTEGER NOT NULL, version_number INTEGER NOT NULL CHECK (version_number > 0),
  event_name TEXT, aliases TEXT[] NOT NULL DEFAULT '{}', description TEXT, category TEXT CHECK (category IN ('ceremony','competition','exhibit','food','trade','cultural','sports','workshop','concert','parade','other')),
  start_datetime TIMESTAMPTZ, end_datetime TIMESTAMPTZ, venue TEXT, organizer TEXT, deadline TIMESTAMPTZ, eligibility TEXT, fees TEXT, contact_info TEXT,
  status TEXT NOT NULL CHECK (status IN ('scheduled','confirmed','postponed','cancelled','completed')),
  change_kind TEXT NOT NULL CHECK (change_kind IN ('initial','confirmation','correction','reschedule','venue_change','deadline_change','postponement','cancellation','completion','administrative_republish')),
  reconciliation_run_id UUID REFERENCES public.event_reconciliation_runs(id) ON DELETE RESTRICT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), superseded_at TIMESTAMPTZ,
  UNIQUE (canonical_event_id, version_number), UNIQUE (id, canonical_event_id, festival_year),
  CHECK (end_datetime IS NULL OR start_datetime IS NULL OR end_datetime >= start_datetime)
);
ALTER TABLE public.canonical_events ADD CONSTRAINT canonical_events_current_version_fkey FOREIGN KEY (current_version_id) REFERENCES public.canonical_event_versions(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.event_reconciliation_runs ADD CONSTRAINT reconciliation_runs_version_fkey FOREIGN KEY (canonical_event_version_id) REFERENCES public.canonical_event_versions(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX canonical_event_versions_one_current ON public.canonical_event_versions(canonical_event_id) WHERE superseded_at IS NULL;
-- Current canonical lifecycle snapshots remain discoverable by their exact year.
-- Callers control lifecycle inclusion with status_filter; in particular, the latest
-- cancelled/postponed state must be retrievable so chat can report a correction.
CREATE INDEX canonical_event_versions_retrieval ON public.canonical_event_versions(festival_year, start_datetime, canonical_event_id) WHERE superseded_at IS NULL AND status IN ('scheduled','confirmed','postponed','cancelled');

CREATE TABLE public.event_candidate_associations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), candidate_event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  canonical_event_id UUID REFERENCES public.canonical_events(id) ON DELETE RESTRICT, festival_year INTEGER NOT NULL,
  reconciliation_run_id UUID NOT NULL REFERENCES public.event_reconciliation_runs(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('accepted','rejected','ambiguous','unmatched')), decision_reason TEXT NOT NULL,
  shortlist_json JSONB NOT NULL DEFAULT '[]'::JSONB, gate_json JSONB NOT NULL DEFAULT '{}'::JSONB, gemini_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), superseded_at TIMESTAMPTZ,
  UNIQUE (candidate_event_id, reconciliation_run_id), CHECK (jsonb_typeof(shortlist_json) = 'array'), CHECK (jsonb_typeof(gate_json) = 'object')
);
CREATE UNIQUE INDEX event_candidate_associations_live_accepted ON public.event_candidate_associations(candidate_event_id) WHERE decision = 'accepted' AND superseded_at IS NULL;
CREATE INDEX event_candidate_associations_canonical ON public.event_candidate_associations(canonical_event_id, created_at DESC);

CREATE TABLE public.canonical_event_field_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), canonical_event_version_id UUID NOT NULL REFERENCES public.canonical_event_versions(id) ON DELETE RESTRICT,
  field_name TEXT NOT NULL CHECK (field_name IN ('event_name','aliases','description','category','start_datetime','end_datetime','venue','organizer','deadline','eligibility','fees','contact_info','status','festival_year','lifecycle_status')),
  value_json JSONB NOT NULL, value_hash TEXT NOT NULL CHECK (value_hash ~ '^[0-9a-f]{64}$'), candidate_event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  evidence_index INTEGER NOT NULL CHECK (evidence_index >= 0), source_id UUID NOT NULL REFERENCES public.sources(id) ON DELETE RESTRICT,
  source_fingerprint TEXT NOT NULL, extraction_identity TEXT NOT NULL, selection_reason TEXT NOT NULL,
  reconciliation_run_id UUID NOT NULL REFERENCES public.event_reconciliation_runs(id) ON DELETE RESTRICT, recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (canonical_event_version_id, field_name, candidate_event_id, evidence_index)
);
CREATE INDEX canonical_field_history_provenance ON public.canonical_event_field_history(candidate_event_id, source_id);

CREATE TABLE public.event_reconciliation_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, run_id UUID NOT NULL REFERENCES public.event_reconciliation_runs(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('run_claimed','shortlist_built','gate_passed','gate_failed','gemini_requested','gemini_returned','outcome_selected','canonical_created','version_published','association_written','review_opened','review_resolved','run_failed','run_reclaimed')),
  actor_class TEXT NOT NULL CHECK (actor_class IN ('worker','reviewer','system')), input_hash TEXT, output_hash TEXT, target_ids JSONB NOT NULL DEFAULT '{}'::JSONB, metadata JSONB NOT NULL DEFAULT '{}'::JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (jsonb_typeof(target_ids) = 'object'), CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE public.event_reconciliation_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), run_id UUID NOT NULL REFERENCES public.event_reconciliation_runs(id) ON DELETE RESTRICT,
  candidate_event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT, state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','claimed','resolved','dismissed')),
  reason_codes TEXT[] NOT NULL, shortlist_json JSONB NOT NULL, gate_json JSONB NOT NULL, proposed_outcome JSONB NOT NULL, gemini_classification JSONB,
  reviewer_identity TEXT, resolution_action TEXT, resolution_note TEXT, resolution_idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), claimed_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ,
  UNIQUE (run_id), UNIQUE (resolution_idempotency_key), CHECK (char_length(COALESCE(resolution_note,'')) <= 2000)
);
CREATE INDEX event_reconciliation_reviews_open ON public.event_reconciliation_reviews(created_at) WHERE state IN ('open','claimed');

CREATE OR REPLACE FUNCTION public.reconciliation_prevent_mutation() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
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
CREATE TRIGGER canonical_version_no_delete BEFORE DELETE ON public.canonical_event_versions FOR EACH ROW EXECUTE FUNCTION public.reconciliation_prevent_mutation();
CREATE TRIGGER association_no_update_delete BEFORE UPDATE OR DELETE ON public.event_candidate_associations FOR EACH ROW EXECUTE FUNCTION public.reconciliation_prevent_mutation();
CREATE TRIGGER field_history_no_mutation BEFORE UPDATE OR DELETE ON public.canonical_event_field_history FOR EACH ROW EXECUTE FUNCTION public.reconciliation_prevent_mutation();
CREATE TRIGGER reconciliation_audit_no_mutation BEFORE UPDATE OR DELETE ON public.event_reconciliation_audit FOR EACH ROW EXECUTE FUNCTION public.reconciliation_prevent_mutation();

CREATE OR REPLACE FUNCTION public.validate_canonical_current_version() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v public.canonical_event_versions;
BEGIN
  IF NEW.current_version_id IS NOT NULL THEN SELECT * INTO v FROM public.canonical_event_versions WHERE id = NEW.current_version_id;
    IF NOT FOUND OR v.canonical_event_id <> NEW.id OR v.festival_year <> NEW.festival_year OR v.superseded_at IS NOT NULL THEN RAISE EXCEPTION 'invalid canonical current version'; END IF;
  END IF; RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER canonical_current_version_valid AFTER INSERT OR UPDATE ON public.canonical_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_canonical_current_version();

CREATE OR REPLACE FUNCTION public.validate_reconciliation_provenance() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE e public.events; s_year INTEGER;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = NEW.candidate_event_id;
  IF NOT FOUND OR e.festival_year <> NEW.festival_year THEN RAISE EXCEPTION 'candidate year mismatch'; END IF;
  IF NEW.decision = 'accepted' THEN
    SELECT festival_year INTO s_year FROM public.canonical_events WHERE id = NEW.canonical_event_id;
    IF s_year IS NULL OR s_year <> NEW.festival_year THEN RAISE EXCEPTION 'canonical year mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER event_candidate_association_provenance BEFORE INSERT ON public.event_candidate_associations FOR EACH ROW EXECUTE FUNCTION public.validate_reconciliation_provenance();

CREATE OR REPLACE FUNCTION public.validate_field_history_provenance() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public, extensions AS $$
DECLARE e public.events;
BEGIN
 SELECT * INTO e FROM public.events WHERE id = NEW.candidate_event_id;
 IF NOT FOUND OR e.extracted_source_id <> NEW.source_id OR e.source_fingerprint <> NEW.source_fingerprint OR e.extraction_identity <> NEW.extraction_identity
    OR jsonb_typeof(e.extraction_evidence) <> 'array' OR NEW.evidence_index >= jsonb_array_length(e.extraction_evidence)
    OR encode(extensions.digest(NEW.value_json::text, 'sha256'),'hex') <> NEW.value_hash THEN RAISE EXCEPTION 'invalid field provenance'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canonical_field_history_provenance BEFORE INSERT ON public.canonical_event_field_history FOR EACH ROW EXECUTE FUNCTION public.validate_field_history_provenance();

CREATE TRIGGER canonical_events_updated BEFORE UPDATE ON public.canonical_events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER reconciliation_runs_updated BEFORE UPDATE ON public.event_reconciliation_runs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.claim_event_reconciliation(p_candidate_event_id UUID, p_reconciler_version TEXT, p_claim_token UUID, p_lease_seconds INTEGER DEFAULT 120)
RETURNS public.event_reconciliation_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE v public.event_reconciliation_runs; e public.events;
BEGIN
 IF p_claim_token IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 300 OR NULLIF(btrim(p_reconciler_version),'') IS NULL THEN RAISE EXCEPTION 'invalid reconciliation lease'; END IF;
 SELECT * INTO e FROM public.events WHERE id=p_candidate_event_id; IF NOT FOUND OR NULLIF(btrim(e.extraction_identity),'') IS NULL OR e.extracted_source_id IS NULL OR NULLIF(btrim(e.source_fingerprint),'') IS NULL OR NULLIF(btrim(e.extractor_version),'') IS NULL OR e.candidate_index IS NULL OR NULLIF(btrim(e.event_name),'') IS NULL THEN RAISE EXCEPTION 'candidate_ineligible'; END IF;
 INSERT INTO public.event_reconciliation_runs(candidate_event_id,reconciler_version,candidate_extraction_identity,candidate_source_id,candidate_source_fingerprint) VALUES(e.id,p_reconciler_version,e.extraction_identity,e.extracted_source_id,e.source_fingerprint) ON CONFLICT DO NOTHING;
 SELECT * INTO v FROM public.event_reconciliation_runs WHERE candidate_event_id=e.id AND reconciler_version=p_reconciler_version FOR UPDATE;
 IF v.status IN ('reconciled','needs_review','permanent_error') OR (v.status='processing' AND v.lease_expires_at>clock_timestamp()) THEN RETURN v; END IF;
 UPDATE public.event_reconciliation_runs SET status='processing',attempt_count=attempt_count+1,claim_token=p_claim_token,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),started_at=clock_timestamp(),completed_at=NULL,last_error_code=NULL,last_error_message=NULL WHERE id=v.id RETURNING * INTO v;
 INSERT INTO public.event_reconciliation_audit(run_id,action,actor_class,target_ids) VALUES(v.id,CASE WHEN v.attempt_count>1 THEN 'run_reclaimed' ELSE 'run_claimed' END,'worker',jsonb_build_object('candidate_event_id',e.id)); RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.fail_event_reconciliation(p_run_id UUID,p_claim_token UUID,p_status TEXT,p_error_code TEXT,p_error_message TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
BEGIN
 IF p_status NOT IN ('retryable_error','permanent_error') THEN RAISE EXCEPTION 'invalid reconciliation error status'; END IF;
 UPDATE public.event_reconciliation_runs SET status=p_status,last_error_code=left(COALESCE(p_error_code,'unknown'),100),last_error_message=left(COALESCE(p_error_message,'reconciliation failure'),2000),completed_at=clock_timestamp(),claim_token=NULL,lease_expires_at=NULL WHERE id=p_run_id AND status='processing' AND claim_token=p_claim_token AND lease_expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid or expired reconciliation claim'; END IF;
 INSERT INTO public.event_reconciliation_audit(run_id,action,actor_class,metadata) VALUES(p_run_id,'run_failed','worker',jsonb_build_object('code',left(COALESCE(p_error_code,'unknown'),100)));
END $$;

CREATE OR REPLACE FUNCTION public.resolve_event_reconciliation(p_run_id UUID,p_claim_token UUID,p_candidate_event_id UUID,p_reconciler_version TEXT,p_input_hash TEXT,p_outcome JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions SET timezone = 'UTC' AS $$
DECLARE r public.event_reconciliation_runs; e public.events; src public.sources; action TEXT; target UUID; ce public.canonical_events; oldv public.canonical_event_versions; newv UUID; digest TEXT; decision TEXT; reason TEXT; fields JSONB; f JSONB; n INTEGER:=0;
BEGIN
 IF jsonb_typeof(p_outcome)<>'object' OR NULLIF(btrim(p_input_hash),'') IS NULL THEN RAISE EXCEPTION 'invalid reconciliation outcome'; END IF;
 digest:=encode(extensions.digest(p_outcome::text,'sha256'),'hex'); SELECT * INTO e FROM public.events WHERE id=p_candidate_event_id FOR UPDATE; SELECT * INTO src FROM public.sources WHERE id=e.extracted_source_id FOR UPDATE;
 SELECT * INTO r FROM public.event_reconciliation_runs WHERE id=p_run_id FOR UPDATE;
 IF NOT FOUND OR r.candidate_event_id<>p_candidate_event_id OR r.reconciler_version<>p_reconciler_version THEN RAISE EXCEPTION 'run identity mismatch'; END IF;
 IF r.status IN ('reconciled','needs_review') THEN IF r.input_hash=p_input_hash AND r.outcome_digest=digest THEN RETURN jsonb_build_object('status',r.status,'cached',true,'canonical_event_id',r.canonical_event_id,'canonical_event_version_id',r.canonical_event_version_id); END IF; RAISE EXCEPTION 'non_deterministic_reconciliation_replay'; END IF;
 IF r.status<>'processing' OR r.claim_token IS DISTINCT FROM p_claim_token OR r.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'invalid or expired reconciliation claim'; END IF;
 IF e.extraction_identity<>r.candidate_extraction_identity OR e.extracted_source_id<>r.candidate_source_id OR e.source_fingerprint<>r.candidate_source_fingerprint OR e.festival_year IS NULL OR e.festival_year<>src.festival_year THEN RAISE EXCEPTION 'candidate provenance mismatch'; END IF;
 action:=p_outcome->>'action'; reason:=left(COALESCE(p_outcome->>'reason','unspecified'),200); IF action NOT IN ('create','merge','unchanged','needs_review','reject') OR jsonb_typeof(COALESCE(p_outcome->'shortlist','[]'::jsonb))<>'array' OR jsonb_typeof(COALESCE(p_outcome->'gate','{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'invalid deterministic outcome'; END IF;
 IF action IN ('needs_review','reject') THEN
   decision:=CASE WHEN action='reject' THEN 'rejected' ELSE 'ambiguous' END;
   INSERT INTO public.event_candidate_associations(candidate_event_id,canonical_event_id,festival_year,reconciliation_run_id,decision,decision_reason,shortlist_json,gate_json,gemini_json) VALUES(e.id,NULL,e.festival_year,r.id,decision,reason,p_outcome->'shortlist',p_outcome->'gate',p_outcome->'gemini');
   IF action='needs_review' THEN INSERT INTO public.event_reconciliation_reviews(run_id,candidate_event_id,reason_codes,shortlist_json,gate_json,proposed_outcome,gemini_classification) VALUES(r.id,e.id,ARRAY[reason],p_outcome->'shortlist',p_outcome->'gate',p_outcome,p_outcome->'gemini'); INSERT INTO public.event_reconciliation_audit(run_id,action,actor_class) VALUES(r.id,'review_opened','worker'); END IF;
   UPDATE public.event_reconciliation_runs SET status=CASE WHEN action='needs_review' THEN 'needs_review' ELSE 'reconciled' END,selected_outcome=action,input_hash=p_input_hash,outcome_digest=digest,completed_at=clock_timestamp(),claim_token=NULL,lease_expires_at=NULL WHERE id=r.id; RETURN jsonb_build_object('status',CASE WHEN action='needs_review' THEN 'needs_review' ELSE 'reconciled' END,'cached',false);
 END IF;
 IF action='create' THEN
   IF COALESCE((p_outcome->'gate'->>'passes')::boolean,false) IS NOT TRUE OR jsonb_typeof(p_outcome->'snapshot')<>'object' THEN RAISE EXCEPTION 'invalid create gate'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended(lower(regexp_replace(e.event_name,'[^[:alnum:]]+',' ','g'))||':'||e.festival_year::text,0));
   INSERT INTO public.canonical_events(festival_year,lifecycle_status) VALUES(e.festival_year,COALESCE(p_outcome->'snapshot'->>'status','scheduled')) RETURNING * INTO ce;
 ELSE
   target:=(p_outcome->>'canonical_event_id')::uuid; SELECT * INTO ce FROM public.canonical_events WHERE id=target FOR UPDATE; IF NOT FOUND OR ce.festival_year<>e.festival_year OR ce.lifecycle_status IN ('cancelled','completed') OR COALESCE((p_outcome->'gate'->>'passes')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'invalid merge target'; END IF;
   SELECT * INTO oldv FROM public.canonical_event_versions WHERE id=ce.current_version_id FOR UPDATE;
 END IF;
 IF action IN ('create','merge') THEN
   INSERT INTO public.canonical_event_versions(canonical_event_id,festival_year,version_number,event_name,aliases,description,category,start_datetime,end_datetime,venue,organizer,deadline,eligibility,fees,contact_info,status,change_kind,reconciliation_run_id)
   SELECT ce.id,e.festival_year,COALESCE(oldv.version_number,0)+1, p_outcome->'snapshot'->>'event_name',COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_outcome->'snapshot'->'aliases')),'{}'),p_outcome->'snapshot'->>'description',p_outcome->'snapshot'->>'category',NULLIF(p_outcome->'snapshot'->>'start_datetime','')::timestamptz,NULLIF(p_outcome->'snapshot'->>'end_datetime','')::timestamptz,p_outcome->'snapshot'->>'venue',p_outcome->'snapshot'->>'organizer',NULLIF(p_outcome->'snapshot'->>'deadline','')::timestamptz,p_outcome->'snapshot'->>'eligibility',p_outcome->'snapshot'->>'fees',p_outcome->'snapshot'->>'contact_info',COALESCE(p_outcome->'snapshot'->>'status',ce.lifecycle_status),COALESCE(p_outcome->>'change_kind','initial'),r.id RETURNING id INTO newv;
   IF oldv.id IS NOT NULL THEN UPDATE public.canonical_event_versions SET superseded_at=clock_timestamp() WHERE id=oldv.id; END IF;
   UPDATE public.canonical_events SET lifecycle_status=(p_outcome->'snapshot'->>'status'),current_version_id=newv WHERE id=ce.id;
   fields:=COALESCE(p_outcome->'field_evidence','[]'::jsonb); IF jsonb_typeof(fields)<>'array' OR jsonb_array_length(fields)=0 THEN RAISE EXCEPTION 'missing field evidence'; END IF;
   FOR f IN SELECT value FROM jsonb_array_elements(fields) LOOP
     INSERT INTO public.canonical_event_field_history(canonical_event_version_id,field_name,value_json,value_hash,candidate_event_id,evidence_index,source_id,source_fingerprint,extraction_identity,selection_reason,reconciliation_run_id) VALUES(newv,f->>'field_name',f->'value_json',encode(extensions.digest((f->'value_json')::text,'sha256'),'hex'),e.id,(f->>'evidence_index')::integer,e.extracted_source_id,e.source_fingerprint,e.extraction_identity,COALESCE(f->>'selection_reason','deterministic_precedence'),r.id); n:=n+1;
   END LOOP;
 ELSE newv:=oldv.id; END IF;
 INSERT INTO public.event_candidate_associations(candidate_event_id,canonical_event_id,festival_year,reconciliation_run_id,decision,decision_reason,shortlist_json,gate_json,gemini_json) VALUES(e.id,ce.id,e.festival_year,r.id,'accepted',reason,p_outcome->'shortlist',p_outcome->'gate',p_outcome->'gemini');
 UPDATE public.event_reconciliation_runs SET status='reconciled',selected_outcome=action,input_hash=p_input_hash,outcome_digest=digest,canonical_event_id=ce.id,canonical_event_version_id=newv,completed_at=clock_timestamp(),claim_token=NULL,lease_expires_at=NULL WHERE id=r.id;
 INSERT INTO public.event_reconciliation_audit(run_id,action,actor_class,target_ids) VALUES(r.id,CASE WHEN action='create' THEN 'canonical_created' ELSE 'association_written' END,'worker',jsonb_build_object('canonical_event_id',ce.id,'version_id',newv));
 RETURN jsonb_build_object('status','reconciled','cached',false,'canonical_event_id',ce.id,'canonical_event_version_id',newv,'field_history_rows',n);
END $$;

CREATE OR REPLACE FUNCTION public.resolve_event_reconciliation_review(p_review_id UUID,p_resolution_idempotency_key TEXT,p_reviewer_identity TEXT,p_action TEXT,p_note TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET timezone = 'UTC' AS $$
DECLARE v public.event_reconciliation_reviews;
BEGIN
 IF NULLIF(btrim(p_resolution_idempotency_key),'') IS NULL OR NULLIF(btrim(p_reviewer_identity),'') IS NULL OR p_action NOT IN ('dismiss','reject') OR char_length(COALESCE(p_note,''))>2000 THEN RAISE EXCEPTION 'invalid review resolution'; END IF;
 SELECT * INTO v FROM public.event_reconciliation_reviews WHERE id=p_review_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'review not found'; END IF;
 IF v.state='resolved' THEN RETURN jsonb_build_object('status','resolved','cached',true); END IF;
 UPDATE public.event_reconciliation_reviews SET state='resolved',reviewer_identity=left(p_reviewer_identity,200),resolution_action=p_action,resolution_note=left(COALESCE(p_note,''),2000),resolution_idempotency_key=p_resolution_idempotency_key,resolved_at=clock_timestamp() WHERE id=v.id;
 INSERT INTO public.event_reconciliation_audit(run_id,action,actor_class) VALUES(v.run_id,'review_resolved','reviewer'); RETURN jsonb_build_object('status','resolved','cached',false);
END $$;

CREATE OR REPLACE VIEW public.event_reconciliation_review_queue WITH (security_invoker = true) AS
SELECT rv.id AS review_id,rv.state,rv.reason_codes,rv.shortlist_json,rv.gate_json,rv.proposed_outcome,rv.created_at,r.id AS run_id,r.attempt_count,r.last_error_code,e.id AS candidate_event_id,e.event_name,e.festival_year,s.post_url,s.published_at AS source_published_at
FROM public.event_reconciliation_reviews rv JOIN public.event_reconciliation_runs r ON r.id=rv.run_id JOIN public.events e ON e.id=rv.candidate_event_id JOIN public.sources s ON s.id=e.extracted_source_id;

CREATE OR REPLACE FUNCTION public.get_event_candidates_for_audit(p_canonical_event_id UUID) RETURNS TABLE(candidate_event_id UUID,association_id UUID,decision TEXT,source_id UUID,source_fingerprint TEXT,extraction_identity TEXT) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$ SELECT e.id,a.id,a.decision,e.extracted_source_id,e.source_fingerprint,e.extraction_identity FROM public.event_candidate_associations a JOIN public.events e ON e.id=a.candidate_event_id WHERE a.canonical_event_id=p_canonical_event_id ORDER BY a.created_at,e.id $$;

CREATE OR REPLACE FUNCTION public.get_festival_events(target_festival_year INT,start_date TIMESTAMPTZ DEFAULT NULL,end_date TIMESTAMPTZ DEFAULT NULL,category_filter TEXT[] DEFAULT NULL,status_filter TEXT[] DEFAULT NULL) RETURNS TABLE(id UUID,event_name TEXT,aliases TEXT[],description TEXT,category TEXT,start_datetime TIMESTAMPTZ,end_datetime TIMESTAMPTZ,venue TEXT,organizer TEXT,deadline TIMESTAMPTZ,eligibility TEXT,fees TEXT,contact_info TEXT,status TEXT,festival_year INT) LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $$
 SELECT ce.id,v.event_name,v.aliases,v.description,v.category,v.start_datetime,v.end_datetime,v.venue,v.organizer,v.deadline,v.eligibility,v.fees,v.contact_info,v.status,v.festival_year FROM public.canonical_events ce JOIN public.canonical_event_versions v ON v.id=ce.current_version_id WHERE ce.festival_year=target_festival_year AND v.festival_year=target_festival_year AND v.superseded_at IS NULL AND ce.lifecycle_status=v.status AND ce.lifecycle_status IN ('scheduled','confirmed','postponed','cancelled') AND (start_date IS NULL OR v.end_datetime>=start_date) AND (end_date IS NULL OR v.start_datetime<=end_date) AND (category_filter IS NULL OR v.category=ANY(category_filter)) AND (status_filter IS NULL OR v.status=ANY(status_filter)) ORDER BY v.start_datetime NULLS LAST,lower(v.event_name),ce.id $$;

ALTER TABLE public.canonical_events ENABLE ROW LEVEL SECURITY; ALTER TABLE public.canonical_event_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.event_candidate_associations ENABLE ROW LEVEL SECURITY; ALTER TABLE public.canonical_event_field_history ENABLE ROW LEVEL SECURITY; ALTER TABLE public.event_reconciliation_runs ENABLE ROW LEVEL SECURITY; ALTER TABLE public.event_reconciliation_audit ENABLE ROW LEVEL SECURITY; ALTER TABLE public.event_reconciliation_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY canonical_events_service ON public.canonical_events FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role'); CREATE POLICY canonical_versions_service ON public.canonical_event_versions FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role'); CREATE POLICY candidate_associations_service ON public.event_candidate_associations FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role'); CREATE POLICY canonical_history_service ON public.canonical_event_field_history FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role'); CREATE POLICY reconciliation_runs_service ON public.event_reconciliation_runs FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role'); CREATE POLICY reconciliation_audit_service ON public.event_reconciliation_audit FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role'); CREATE POLICY reconciliation_reviews_service ON public.event_reconciliation_reviews FOR ALL USING (auth.role()='service_role') WITH CHECK (auth.role()='service_role');
REVOKE ALL ON public.canonical_events,public.canonical_event_versions,public.event_candidate_associations,public.canonical_event_field_history,public.event_reconciliation_runs,public.event_reconciliation_audit,public.event_reconciliation_reviews,public.event_reconciliation_review_queue FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_event_reconciliation(UUID,TEXT,UUID,INTEGER),public.fail_event_reconciliation(UUID,UUID,TEXT,TEXT,TEXT),public.resolve_event_reconciliation(UUID,UUID,UUID,TEXT,TEXT,JSONB),public.resolve_event_reconciliation_review(UUID,TEXT,TEXT,TEXT,TEXT),public.get_event_candidates_for_audit(UUID) FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.canonical_events,public.canonical_event_versions,public.event_candidate_associations,public.canonical_event_field_history,public.event_reconciliation_runs,public.event_reconciliation_audit,public.event_reconciliation_reviews TO service_role; GRANT SELECT ON public.event_reconciliation_review_queue TO service_role; GRANT EXECUTE ON FUNCTION public.claim_event_reconciliation(UUID,TEXT,UUID,INTEGER),public.fail_event_reconciliation(UUID,UUID,TEXT,TEXT,TEXT),public.resolve_event_reconciliation(UUID,UUID,UUID,TEXT,TEXT,JSONB),public.resolve_event_reconciliation_review(UUID,TEXT,TEXT,TEXT,TEXT),public.get_event_candidates_for_audit(UUID) TO service_role;
