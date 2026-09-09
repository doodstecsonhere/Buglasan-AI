# Phase 10 terminal retry — preserved terminal-state contract

Phase 10 closure was accepted on 2026-09-09 (Asia/Manila). Migrations 001–017 are preserved, including the deployed cache-currentness repair in [`017_repair_cached_index_currentness.sql`](../supabase/migrations/017_repair_cached_index_currentness.sql). Phase 11 has not started.

The four terminal extraction failures below remain deliberately untouched: no recovery endpoint was invoked, no terminal failure was retried, and n8n remains stopped. This historical recovery contract is not an approval to operate on production data.

## Scope and safety

The new [migration](../supabase/migrations/016_phase10_terminal_retry.sql) adds an atomic service-only authorization/claim for exactly these four sources:

- 0f73eba4-daa0-48ca-82a8-a4ae02284793
- 2d9a28eb-a142-4bc2-b694-530d141e0cbc
- 8f0d3c75-a084-410c-8d1b-0800655cec21
- b025846e-1928-4ac9-95dd-cf02972dd0dc

254d56af-7bf4-4913-8a9b-d5ab34367b33 is excluded. The operator never reads it.
The isolated negative test sends its ID only to an empty disposable database.

## Implemented privileged recovery path

Privileged terminal recovery is implemented in the [extract-source edge handler](../supabase/functions/extract-source/index.ts) and backed by [migration 016](../supabase/migrations/016_phase10_terminal_retry.sql). It is an exact-source/fingerprint/version-bound path: it requires the matching source and extraction before-images, the current source fingerprint, and the exact phase6-v1 extractor version, together with `PHASE10_OPERATOR_TOKEN` and approved operator metadata. The database claim atomically consumes one retry claim before extraction. A privileged request does not invoke reconciliation; ordinary extraction remains unchanged, including its existing opt-in reconciliation handoff when separately configured.

This implemented handler path is distinct from the [inspection-only script](../scripts/phase10-terminal-retry.ts) and the separate [local privileged runner](../scripts/phase10-terminal-recovery-live.ts). The inspection script never authorizes, claims, or executes recovery. The local runner defaults to a single-source dry run, obtains the current complete before-images through sequential safe reads, and sends at most one privileged request only with `--execute`; `PHASE10_OPERATOR_TOKEN` is required only for that explicit execution. It accepts only the four IDs above and never logs credentials, raw rows, or response bodies. Live execution still requires explicit operator authorization and an approved deployed configuration; repository documentation, local inspection, or the presence of the handler and migration is not that authorization.

Authorization locks source then extraction, requires complete JSONB row equality, current fingerprint, exact phase6-v1 version, permanent error with extraction_failed code at attempt four, and absent owner and lease. It requires a current eligible Facebook source with text, official Buglasan numeric-post provenance, and nonempty operator review metadata. Synthetic/test markers are conservatively refused. These checks do not independently authenticate provenance; human review remains mandatory. Legitimate metadata containing a denied marker is also refused, not edited to fit.

Any existing source-local candidate or event-source link blocks authorization, including historical fingerprints. No evidence is overwritten in that case. On acceptance the full source and extraction before-images are recorded before count changes **4 → 5**; errors/results remain in place until normal completion. Audit tables have no application write grants, immutable update/delete triggers, and no cascading source foreign key. The permanent tuple fence blocks deletion, identity changes, reset and attempt six. Service role remains a trusted backend principal; database owners can bypass DDL protections and are outside the application privilege boundary.

Duplicate authorization fails, never returns ownership. Ordinary claim receipts for fenced tuples redact owner and lease, including when the caller repeats the original token. Transient failure is converted to permanent error, with the new diagnostic recorded separately from immutable history. Completion snapshots are append-only. A crashed/expired claim stays consumed and processing: absence of an outcome plus expired lease means **indeterminate**, not permission to retry. No automatic timeout finalizer is added.

The local recovery runner treats every non-2xx response after the privileged request as **claim consumed; outcome indeterminate; no retry**. It reports only that operator-safe state, never a rejected/provider response body, and does not submit a second request.

Unrelated tuples keep their existing behavior. No frontend reset, provider/model/budget/validator change, source/content/fingerprint edits, reingest, indexing, canonical mutation, reconciliation call, n8n restart, history deletion, or secret change is introduced.

### Independent finding remediation and compatibility

Migration 006 granted the service role all extraction-table privileges, including truncation, which bypasses row update/delete triggers. Migration 016 now revokes extraction-table truncation from PUBLIC and all three application roles. Ordinary claims also match the immutable audit's source/fingerprint/version tuple, not only the extraction ID. If privileged maintenance removes or replaces the original row, an ordinary claim raises an error and rolls back any pending insertion; a new ID cannot renew consumed authorization.

This deliberately removes application-level bulk history deletion, for which no legitimate repository call site was found. Existing row-level grants and normal claim/persistence behavior remain unchanged. No foreign key or cascade is added to the immutable audit. Owners remain outside the application privilege boundary; the isolated suite uses owner-only, rolled-back truncation solely to exercise defense against missing/replaced IDs, never as an operational recovery procedure.

Regression coverage includes actual service-role truncation and cascading-truncation denial; missing and replaced extraction IDs; unaudited pending/retryable claims, all four terminal cache states, active leases, and distinct fingerprints/versions; complete source/extraction before-image equality; complete outcome snapshot equality and preservation of prior outcomes. Temporary-file operator tests check receipt contents before the first mocked request, completed/partial receipt retention, and refusal before networking on rerun. These tests do not claim power-loss/filesystem durability certification.

## Reconciliation stop gate

The [existing edge handler](../supabase/functions/extract-source/index.ts) can directly invoke reconcile-event after successful extraction when its environment switch and token are enabled. Stopping n8n is insufficient. There is no per-request bypass or read-only configuration attestation in that handler. Repository source cannot prove the deployed v35 environment is disabled, and production configuration was not accessed in this work.

**Live execution is outside the accepted Phase 10 closure.** No edge change/deployment is included. The SQL claim alone does not invoke an extractor. Calling the ordinary edge endpoint afterwards does not consume that claim: the fenced ordinary claim returns no owner. Do not work around this with manual resets or direct provider calls.

A later independently authorized change must either prove deployed reconciliation is disabled and design a safe claim-consuming integration, or add and deploy a narrowly capability-bound no-reconcile extraction path. Any successful output must also remain protected from independent dispatcher/reconciliation consumers. This is not solved by the SQL fence and is not claimed as implemented. Do not deploy this migration in isolation as a live run procedure.

## Exact currently permitted operator procedure

1. Independently review the baseline and this patch. Do not apply production migrations, commit, push, deploy or execute extraction under this task.
2. For separately approved read-only inspection, use a restricted operator session with the existing service credential supplied through its environment; do not print/copy credentials or change secrets. The [runner](../scripts/phase10-terminal-retry.ts) hardcodes project uelezensmkxfyexcwqzb and cannot accept another URL or arbitrary IDs.
3. Invoke Node with experimental type stripping on that runner, with no argument or with the inspection option. It exclusively GETs the four sources, their phase6-v1 extraction rows, candidate IDs and links, sequentially, with no redirects or network retries. It reserves and fsyncs an exclusive local receipt before networking. A preexisting receipt stops rerun; do not delete it to force continuation. Treat a partial receipt as indeterminate and retain it for review. The receipt is newline-delimited records and contains source text: store it as sensitive evidence, never commit it.
4. Independently inspect every full source/extraction snapshot, provenance and absence of candidates. Multiple extraction fingerprints require human identification of the exact current tuple. Inspection is not authorization. SQL rechecks complete snapshots atomically; any drift requires a new review, never blind resubmission.
5. **STOP unless separately authorized.** The checked-in recovery runner is not an approval. Its safe command shape is `npm run phase10:terminal-recovery -- <one-authorized-source-id>` for inspection, or the same command with `--execute` only after explicit approval and with `SUPABASE_SECRET_KEY`, `EXTRACT_SOURCE_TOKEN`, and `PHASE10_OPERATOR_TOKEN` supplied through the environment (never in the command or output). It makes one request maximum for that source, stops on claim rejection/state drift/unexpected response, and never retries. Do not use the excluded ID or arbitrary IDs.

## Tests and evidence limits

- [Operator tests](../scripts/phase10-terminal-retry.test.ts): fixed target/four IDs, inspection default, execution refusal, read-only scoped requests, fail-closed/no-retry behavior. Fetch is mocked; no production inspection runs.
- [Database suite](../scripts/phase10-terminal-retry-db.mjs): run with Node. Uses an existing local pgvector PostgreSQL 17 image in a unique network-disabled container, no host ports, and removes only that container. Bootstraps Supabase roles/auth stubs and extension placement, then executes actual migrations 001–016. Exercises rejection matrix, public-role denial, real concurrent sessions, immutable history, normal terminal caching, transient failure fencing, real lease expiry, duplicate owner redaction and successful no-event persistence. This is real SQL, not Supabase/PostgREST/edge end-to-end validation.
- Run the configured npm test, typecheck, build and lint commands plus git diff whitespace checking. The configured typecheck excludes scripts; explicitly typecheck the new operator and test with TypeScript NodeNext/no-emit options as an additional gate.
- No provider call, candidate-bearing successful extraction, deployed v35 configuration proof, live extraction or canonical reconciliation test is claimed. The SQL authorization and recovery paths create no events in the isolated tests. This is not proof that the unchanged edge success path cannot reconcile.

No existing live acceptance/cleanup harness may be used to validate this work: those ingest/delete fixtures.
