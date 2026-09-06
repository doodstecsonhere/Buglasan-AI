# Phase 8 Event Reconciliation — Implementation Design

## 1. Purpose, boundary, and invariants

Phase 8 introduces a forward-only reconciliation layer that turns immutable Phase 6 source-local `events` rows into auditable candidate observations linked to a canonical, festival-year-specific event. It replaces neither source ingestion nor extraction and does not alter historical candidate content.

The existing `public.events` table is retained as the immutable candidate ledger. For this phase, an event row means exactly one deterministic extractor candidate identified by `extraction_identity`, not an application-level canonical event. Existing source supersession remains independent evidence lineage. `events.is_current` retains its existing meaning: whether that candidate belongs to a current source fingerprint and has a retrieval-eligible candidate status. It must not be overloaded to mean canonical currentness, match acceptance, or review completion.

Normative invariants:

- No Phase 8 operation updates candidate business fields, extraction identity/provenance, or candidate currentness in `public.events`.
- Canonical identity is scoped to one `festival_year`; candidates from different years never match automatically or manually.
- A candidate has at most one accepted canonical association at a time. Rejected/no-match/ambiguous attempts remain audit records and do not erase prior audit history.
- One canonical event has at most one retrieval-current version. A version is immutable after publication.
- Every canonical field value is backed by one or more validated candidate evidence references. The system never manufactures a fact from model output or a reviewer comment.
- Deterministic rules decide the candidate shortlist, hard gate, normal outcome, and record ordering. Gemini may only classify among deterministic options or request review; it cannot create candidates, canonical events, field values, evidence, or lifecycle actions.
- Reconciliation is source-version aware but does not infer source supersession. A newer source may correct a canonical record only after independent candidate reconciliation.
- Chat moves from direct candidate retrieval to canonical current-version retrieval only after the backfill and parity gate succeed. The legacy candidate RPC remains available for audit/rollback and is not removed in Phase 8.

## 2. Data model

Create one forward migration, `supabase/migrations/011_event_reconciliation.sql`. Use UUIDs, `TIMESTAMPTZ`, `clock_timestamp()`, `public` qualification, fixed `SECURITY DEFINER` search paths, and append-only application history. No destructive DDL, rewrite of Phase 6 rows, or change to extraction identities is permitted.

### 2.1 Canonical events and immutable versions

`public.canonical_events` contains stable identity and lifecycle state:

```sql
CREATE TABLE public.canonical_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_year INTEGER NOT NULL,
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN (
    'scheduled','confirmed','postponed','cancelled','completed'
  )),
  current_version_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, festival_year)
);
```

`public.canonical_event_versions` stores a full immutable canonical snapshot. It has a UUID primary key, `canonical_event_id`, `festival_year`, monotonically increasing `version_number`, the current structured event fields (name, aliases, description, category, start/end, venue, organizer, deadline, eligibility, fees, contact info, status), `change_kind`, `reconciliation_run_id`, `published_at`, and `superseded_at`. Required fields use the Phase 6 nullable shape: a canonical version may be partial, but its value must come from approved evidence. Add `UNIQUE (canonical_event_id, version_number)`, `UNIQUE (id, canonical_event_id, festival_year)`, and `CHECK (end_datetime IS NULL OR start_datetime IS NULL OR end_datetime >= start_datetime)`.

`canonical_events.current_version_id` references `canonical_event_versions.id` through a deferred foreign key. A deferred constraint trigger validates that the referenced version belongs to the same canonical event and festival year, and that its `superseded_at IS NULL`. A partial unique index on `canonical_event_versions(canonical_event_id) WHERE superseded_at IS NULL` enforces exactly one current version once the event is published. A canonical event may have no version only inside the reconciliation transaction that creates it.

`change_kind` is one of `initial`, `confirmation`, `correction`, `reschedule`, `venue_change`, `deadline_change`, `postponement`, `cancellation`, `completion`, or `administrative_republish`. The snapshot `status` must equal the parent canonical lifecycle status at commit. Version rows are INSERT-only to service paths; the database blocks UPDATE and DELETE other than setting `superseded_at` during the atomic publish RPC.

### 2.2 Candidate association and evidence provenance

`public.event_candidate_associations` is the append-only match ledger:

- `id`, `candidate_event_id REFERENCES public.events(id) ON DELETE RESTRICT`, `canonical_event_id REFERENCES public.canonical_events(id) ON DELETE RESTRICT`, `festival_year`, `reconciliation_run_id`, `decision`, `decision_reason`, `shortlist_json`, `gate_json`, `gemini_json`, `created_at`, and `superseded_at`.
- `decision` is `accepted`, `rejected`, `ambiguous`, or `unmatched`.
- `UNIQUE (candidate_event_id, reconciliation_run_id)` makes a run replay deterministic.
- A partial unique index on `(candidate_event_id) WHERE decision = 'accepted' AND superseded_at IS NULL` enforces at most one live accepted association.
- A trigger requires the candidate and canonical event years to equal `festival_year`; the trigger also forbids an accepted association to a cancelled/completed canonical event unless the same atomic publication explicitly creates the next lifecycle version.

`public.canonical_event_field_history` provides field-level provenance rather than relying on version JSON diffing. Each immutable row contains `canonical_event_version_id`, `field_name`, `value_json`, `value_hash`, `candidate_event_id`, `evidence_index`, `source_id`, `source_fingerprint`, `extraction_identity`, `selection_reason`, `reconciliation_run_id`, and `recorded_at`. Permit only the declared canonical fields plus `lifecycle_status`; require `value_hash = sha256(canonical JSON text)` and prohibit duplicated `(version_id, field_name, candidate_event_id, evidence_index)`. A trigger verifies that source/fingerprint/identity exactly match the referenced candidate and that `evidence_index` exists in `events.extraction_evidence`.

For a null field, record a field-history row only when a reviewed outcome explicitly establishes `not_provided` for a field that is permitted to clear. A null never wins merely because an extractor omitted data. Clearable fields are `description`, `venue`, `organizer`, `deadline`, `eligibility`, `fees`, and `contact_info`; name, category, year, dates, and lifecycle status cannot be cleared automatically.

### 2.3 Runs, audit, and review queue

`public.event_reconciliation_runs` is the idempotent job/control-plane ledger keyed by `(candidate_event_id, reconciler_version)`. It records candidate source identity, status (`pending`, `processing`, `reconciled`, `needs_review`, `retryable_error`, `permanent_error`), attempt count, lease token/expiry, deterministic input hash, selected outcome, resulting canonical event/version, safe error code/message, and timestamps. The exact candidate identity plus reconciler version is the replay key; a rule/model/prompt change requires a version bump.

`public.event_reconciliation_audit` is append-only and contains one ordered event per material action: `run_claimed`, `shortlist_built`, `gate_passed`, `gate_failed`, `gemini_requested`, `gemini_returned`, `outcome_selected`, `canonical_created`, `version_published`, `association_written`, `review_opened`, `review_resolved`, `run_failed`, and `run_reclaimed`. It includes `run_id`, actor class, safe deterministic input/output hashes, target IDs, and timestamp. It must not store raw Gemini prompts/responses beyond redacted structured decision metadata, source text, credentials, or unbounded evidence payloads.

`public.event_reconciliation_reviews` is the service-only work queue, not a second decision source. It contains the run/candidate IDs, state (`open`, `claimed`, `resolved`, `dismissed`), reason codes, candidate shortlist and gate snapshot, proposed deterministic outcome, optional Gemini classification, reviewer identity, resolution action, resolution note, resolution idempotency key, and timestamps. Only a secured reviewer RPC may resolve it. Resolution records a new audited reconciliation result; it never edits candidate data or deletes the open review.

Expose `public.event_reconciliation_review_queue` as a `security_invoker` view joining review, run, candidate, and source URL/year metadata. It returns only review-safe diagnostics, no raw model payloads or credentials.

## 3. Candidate eligibility and deterministic same-year matching

### 3.1 Eligibility

Reconcile only candidates where all conditions hold:

1. `events.extraction_identity`, `extracted_source_id`, `source_fingerprint`, extractor version, candidate index, and event name are non-empty and internally consistent.
2. Candidate `festival_year` is non-null and equals `sources.festival_year` for its extracted source.
3. The referenced source fingerprint equals the candidate fingerprint. The source may later be superseded; that changes candidate retrieval eligibility but never invalidates its auditability.
4. Candidate evidence is a JSON array; every field used for automated matching/publication has at least one valid evidence reference.

Candidate `events.is_current` is not an eligibility prerequisite. Reconcile historical candidates too when explicitly backfilling or reviewing; currentness only affects whether they can contribute to current retrieval. The automatic operational worker prioritizes current candidates and may defer inactive candidates, but must not delete or mutate them.

### 3.2 Normalization and shortlist

Implement pure, versioned normalizers in the reconciliation worker and replicate only their required safety checks in SQL. `reconciler-v1` normalization is locale-independent: Unicode NFKC, lowercase, trim, collapse whitespace, remove punctuation except alphanumeric separators, normalize `&` to `and`, and tokenize on spaces. Do not use fuzzy locale collation, embeddings, or current time.

For a candidate C, form its deterministic same-year shortlist from canonical events whose current version has the same `festival_year` and lifecycle status in `scheduled`, `confirmed`, or `postponed`. Cancelled/completed records are excluded from automatic merge targets; matching them requires review so a genuinely reinstated/new event is not silently attached.

For each target T, calculate and retain these exact integer/boolean features:

- `name_exact`: normalized C name equals normalized T name or one of T aliases.
- `name_token_overlap_bp`: 10,000 × intersection/union of normalized token sets, rounded down.
- `date_relation`: `same_day`, `overlap`, `within_48_hours`, `disjoint`, or `unknown`; derived only when both sides have the necessary dates in Manila time.
- `venue_exact`: non-empty normalized venues equal.
- `organizer_exact`: non-empty normalized organizers equal.
- `category_equal`: non-null categories equal.
- `source_lineage`: whether C source is the same source, direct superseding/superseded source, or unrelated to any provenance source of T.

Rank candidates descending by the lexicographic tuple: `name_exact`, `name_token_overlap_bp`, date relation rank (`same_day` > `overlap` > `within_48_hours` > `unknown` > `disjoint`), `venue_exact`, `organizer_exact`, `category_equal`, direct lineage rank, then canonical UUID ascending. Preserve the top 12 and the first score below the cutoff in `shortlist_json`; this proves deterministic truncation.

### 3.3 Hard gate and deterministic outcomes

The automatic association gate passes only if exactly one target meets either rule:

- **Strong identity:** `name_exact` and at least one of `same_day`, `overlap`, `venue_exact`, `organizer_exact`, or direct source lineage.
- **Strong temporal identity:** `name_token_overlap_bp >= 8,500`, date relation is `same_day` or `overlap`, and at least one of `venue_exact`, `organizer_exact`, `category_equal`, or direct source lineage.

The gate fails closed for missing/invalid evidence, a tie on all rank features, multiple passing targets, name overlap below 8,500, disjoint dates without direct lineage, target lifecycle in cancelled/completed, cross-year data, or an empty name. No weighted score, hidden threshold, or non-deterministic database ordering is allowed.

The normal outcomes are:

1. **Create:** empty shortlist or no target passes and candidate evidence satisfies the minimum creation evidence below. Create a new canonical event and initial version.
2. **Merge and publish:** exactly one target passes; create an accepted association and publish a version only if deterministic field selection changes the canonical snapshot or lifecycle status.
3. **Merge without version:** exactly one target passes but approved field selection is identical to its current version. Write association/history/audit only.
4. **Needs review:** gate failure, conflicting validated evidence, lifecycle ambiguity, insufficient creation evidence, or invalid evidence. No canonical mutation occurs.
5. **Reject:** only a reviewer may reject a candidate as non-event/duplicate extraction artifact. Record a rejected association and preserve the candidate.

Minimum automated creation evidence is a valid name evidence reference plus either a valid temporal evidence reference or a valid venue/organizer evidence reference, and a valid festival-year provenance match. Otherwise emit `needs_review: insufficient_create_evidence`.

## 4. Evidence validation and Gemini boundary

Evidence is validated before matching or publication. A usable evidence item must be an object referencing the exact candidate source, identify a non-empty source span or deterministic locator recognized by the Phase 6 extraction contract, name the supported canonical field, and quote/locate a value consistent with the candidate field after the applicable normalizer. Evidence cannot be borrowed from another source, candidate, year, or model response. Invalid, duplicate, out-of-range, field-mismatched, or value-mismatched evidence is rejected with a review reason; it is not silently ignored for required fields.

Field selection precedence is deterministic and evidence-based: source status authority rank (`updated` > `active` > `postponed` > `superseded` > `cancelled` > `archived`), then source `published_at` descending, then candidate `created_at` descending, then candidate UUID ascending. For a field, use the highest-precedence validated non-null proposed value. If equally authoritative conflicting values exist, require review. Do not treat source publication time as a universal truth override: a later source can only replace a field it explicitly evidences.

Gemini is allowed only after deterministic shortlist and gate construction, and only for a bounded ambiguity packet containing candidate/target IDs, normalized comparison features, allowed decision labels, and minimal evidence snippets. It may return one of `choose_target_id` from the supplied shortlist, `create`, or `needs_review`, plus a bounded rationale referencing supplied evidence IDs. Schema-validate the response and require its choice to satisfy the deterministic gate:

- A Gemini choice cannot override a failed gate, create a cross-year match, select an omitted target, select a cancelled/completed target, alter fields, or emit lifecycle semantics.
- If it chooses among multiple valid gate-passing targets, returns malformed output, reports uncertainty, or differs from the deterministic top candidate, the outcome is `needs_review` with `gemini_ambiguity` or `gemini_contract_failure`.
- If a single deterministic target passes, Gemini is not called.

Gemini thus reduces reviewer context only; it never confers authority or changes deterministic outcomes.

## 5. Lifecycle and publication semantics

The current canonical version is a snapshot. Publishing a lifecycle/material correction creates a successor snapshot, marks the prior snapshot superseded, updates `canonical_events.lifecycle_status`, and changes the current-version pointer atomically. The canonical event ID remains stable across correction, venue change, deadline change, postponement, cancellation, and reschedule.

- **Confirmation:** a validated explicit confirmation upgrades `scheduled` to `confirmed`; it never downgrades `confirmed` to `scheduled` automatically.
- **Correction:** corrected descriptive/category/contact/eligibility/fee values publish only the explicitly evidenced changed fields while inheriting unchanged values from the prior snapshot.
- **Reschedule:** a validated new start or end date/time for the same gated identity publishes `change_kind = reschedule`, retains the ID, sets status to `scheduled` unless explicit confirmation supports `confirmed`, and retains old dates only in prior versions/history.
- **Venue change:** a validated new venue for the same identity publishes `venue_change`; it is not a new event by itself.
- **Deadline change:** a validated new deadline publishes `deadline_change`; an explicitly stated extension/reopening may replace a prior deadline. Omission never clears it.
- **Postponement:** an explicit postponement publishes `postponement` with `status = postponed` and no retrieval-current canonical version. The original scheduled/confirmed snapshot becomes historical. A later explicitly scheduled replacement that passes identity gate publishes a reschedule successor and restores retrieval eligibility.
- **Cancellation:** an explicit cancellation publishes `cancellation` with `status = cancelled`; it is never returned as upcoming. A later announcement is never automatically treated as reinstatement; it opens review.
- **Completion:** completion may be recorded by a reviewed/operational transition after event end or explicit evidence. It is historical and never returned as upcoming.

No automatic lifecycle action may be inferred from an absent event in a newer source. Candidate-level `events.status` remains source-local claimed content and cannot itself alter canonical lifecycle without valid status evidence.

## 6. Secured atomic RPCs, idempotency, and ordering

All mutation occurs through service-role-only RPCs. Direct writes to reconciliation tables are revoked from `PUBLIC`, `anon`, and `authenticated`; RLS is enabled with service-role `FOR ALL` policies only. RPC functions are `SECURITY DEFINER`, set `search_path = pg_catalog, public`, use UTC, validate arguments before mutation, and explicitly revoke default function execute grants.

### 6.1 Claim and terminal control plane

`public.claim_event_reconciliation(p_candidate_event_id UUID, p_reconciler_version TEXT, p_claim_token UUID, p_lease_seconds INTEGER DEFAULT 120)` inserts/locks the exact run key. It validates candidate identity, version, and a 30–300 second lease. Terminal exact-version rows return as cache hits; an unexpired `processing` row returns without ownership; `pending`, `retryable_error`, and expired `processing` become owned `processing` rows with incremented attempt count.

`public.fail_event_reconciliation(p_run_id UUID, p_claim_token UUID, p_status TEXT, p_error_code TEXT, p_error_message TEXT)` accepts only retryable/permanent errors, requires matching unexpired ownership, clears the lease, and never changes canonical/association data.

### 6.2 Atomic resolve-and-publish RPC

`public.resolve_event_reconciliation(p_run_id UUID, p_claim_token UUID, p_candidate_event_id UUID, p_reconciler_version TEXT, p_input_hash TEXT, p_outcome JSONB)` is the sole publication path. Its transaction sequence is mandatory:

1. Lock candidate `events` and extracted `sources` rows; revalidate immutable candidate identity, same-year provenance, and the input hash.
2. Lock the reconciliation run; require exact identity/version, `processing`, matching claim token, and unexpired lease.
3. Validate the outcome schema, deterministic shortlist/gate snapshot, all proposed field evidence, allowed outcome, and candidate status/lifecycle action.
4. For a merge, lock the canonical event and current version `FOR UPDATE`; recompute the shortlist/gate from locked data and require byte-equivalent deterministic outcome metadata. For create, take a transaction-scoped advisory lock keyed by normalized name plus festival year before checking again for a matching current canonical event.
5. Stage all field-history rows and verify their provenance before modifying pointers. Create canonical identity/version only when required; otherwise retain the current version.
6. Supersede previous current version, publish the new version, update lifecycle/pointer, insert accepted association, history, audit rows, optional review resolution, and terminal run state in one transaction.
7. For `needs_review`, write only review/audit/terminal-run data; for reviewer reject, write rejected association/audit/terminal run data. Neither path changes canonical state.

Replay is idempotent: the same terminal run returns its stored result. A retry during uncertain transport may call resolve again only with identical input hash and outcome digest; any difference raises `non_deterministic_reconciliation_replay`. An expired/reclaimed worker cannot resolve or fail. Candidate source edits do not invalidate the immutable candidate but current-source mismatch is included in audit and cannot let stale candidate data replace a more authoritative conflicting field without the normal precedence/review rules.

Lock order is globally `events candidate` → `sources extracted source` → `event_reconciliation_runs` → `canonical_events` → `canonical_event_versions`; create uses its advisory key before canonical lookup. No function may take these locks in another order. Canonical writes serialize per canonical event, preventing two candidates from publishing competing successors. Every array/query used for deterministic selection has an explicit `ORDER BY`.

## 7. Backfill and retrieval transition

Backfill is resumable, service-only, and uses the same claim/resolve RPCs and `reconciler-v1`; it never performs bespoke direct inserts. Enumerate Phase 6 candidates by `festival_year ASC`, normalized event name, extracted source ID, source fingerprint, extractor version, candidate index, and UUID. Process all valid candidates, including inactive audit candidates, but prioritize `is_current = true`. Record a backfill batch identifier in run audit metadata.

The first candidate that meets creation requirements creates its canonical record. Later candidates reconcile through the normal same-year rules. Any uncertainty creates an open review rather than a guessed merge. Backfill must be restart-safe: completed keys are cache hits, live leases are skipped, and retryable failures can be resumed. It must report counts for candidates scanned, created, merged, unchanged, ambiguous, invalid evidence, and failures, with IDs scoped to each batch.

Before changing chat, run parity validation for each target festival year and date/category/status filter: compare the legacy candidate RPC output with an audit projection of canonical current versions. Differences must be classified as expected deduplication, expected review exclusion, or defect; unresolved differences block transition. Verify no canonical current version lacks field provenance and that every retrieval result has at least one accepted candidate association from a valid source.

Replace `public.get_festival_events` implementation without changing its public parameter/result signature. It selects only `canonical_event_versions` joined to `canonical_events` where the version is current, the event/year agree, `lifecycle_status` and version status are `scheduled` or `confirmed`, and existing date/category/status filters apply. It orders deterministically by `start_datetime NULLS LAST`, normalized event name, canonical event ID. The chat function continues calling `get_festival_events` directly; no chat call should query candidate rows after transition. Keep a new service-only `get_event_candidates_for_audit` view/RPC for provenance and rollback diagnostics.

Rollback is a retrieval-only configuration/function restoration to the legacy Phase 6 `get_festival_events` body; it does not delete canonical tables, audit data, associations, or candidate rows. Reconciliation processing can be paused by disabling the worker trigger while preserving review access.

## 8. Migration contents, security, and verification

Migration `011_event_reconciliation.sql` must include:

1. New canonical, version, association, field-history, run, audit, and review tables; constraints, append-only guards, updated-at triggers where appropriate, and supporting indexes for year/current retrieval, run claims, open reviews, and provenance joins.
2. RLS enablement on every new table; no public/authenticated policies; service-role-only policies and grants; service-only security-invoker review view.
3. The three secured worker RPCs plus a secured reviewer-resolution RPC, all fixed-search-path, UTC, ownership/lease checked, and explicitly revoked/granted.
4. A replacement `get_festival_events` preserving exact public signature/result shape, plus a service-only audit projection/RPC.
5. Comment blocks documenting that direct `events` rows are immutable candidates, source supersession is separate, and candidate `is_current` is not canonical currentness.
6. No changes to existing event candidate columns, extraction persistence semantics, source supersession behavior, or deletion policy.

Security controls:

- Edge/n8n worker authentication uses a separate trusted reconciliation token and `verify_jwt = false`, with constant-time comparison; reviewer endpoints require a separate operator token or authenticated role introduced explicitly by a later approved auth design.
- Client input is limited to candidate/run IDs. It cannot supply matching features, Gemini decisions, canonical fields, evidence, source data, or lifecycle status.
- Gemini API keys, trusted tokens, raw prompts, raw source text, and raw provider responses never enter review views, audit rows, normal endpoint bodies, or logs.
- Reviewer notes are bounded/sanitized and are not treated as evidence. Reviewer resolution must reference candidate evidence IDs and an explicit resolution idempotency key.

Required tests:

- Static migration/security test asserts forward-only DDL, RLS/grants, fixed search paths, signature preservation, locks, lease checks, append-only guards, partial uniqueness, and no mutation of candidate business fields.
- Pure unit tests cover normalization, same-year shortlist ordering, all gate boundaries, ties, null/missing dates, cross-year exclusion, deterministic field precedence, and identical replay hashes.
- RPC/integration tests cover duplicate delivery, concurrent claim, expired lease reclaim, stale token rejection, source edit during work, competing canonical updates, create advisory locking, atomic rollback on invalid evidence, and exact replay.
- Lifecycle tests cover confirmation, correction, reschedule, venue/deadline changes, postponement and later rescheduling, cancellation, attempted reinstatement review, and retrieval inclusion/exclusion.
- Gemini tests prove it receives only bounded supplied options, cannot override a failed gate, and malformed/uncertain/conflicting answers route to review.
- Backfill/live acceptance tests use explicit test fixtures, assert no direct event mutation, prove one current canonical version per event, validate field provenance, run legacy/canonical retrieval parity, and scope cleanup to exact test IDs.

## 9. Implementation sequence

1. Add versioned pure reconciliation normalization, shortlist, gate, evidence-validation, and outcome-selection helpers with exhaustive unit tests.
2. Add migration `011_event_reconciliation.sql` with schema, constraints, RLS, append-only guards, RPCs, review view, and backward-compatible retrieval implementation gated for rollout.
3. Add reconciliation Edge Function/worker and structured Gemini ambiguity adapter; restrict it to claim → deterministic evaluation → optional bounded Gemini classification → atomic resolve/fail.
4. Add reviewer resolution endpoint/tooling that uses the secured resolution RPC and evidence references only.
5. Add migration, RPC, endpoint, concurrency, lifecycle, and retrieval-parity tests.
6. Execute resumable backfill in dry-run reporting mode, remediate review queue, then execute service-only writes with batch-scoped audit.
7. Complete parity/provenance gates, switch `get_festival_events` to canonical current versions, monitor audit/review/failure metrics, and retain legacy retrieval rollback path.
