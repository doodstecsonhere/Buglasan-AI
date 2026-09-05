# Phase 6 — Evidence-grounded knowledge extraction (Workflow B)

## Boundary

Workflow B accepts one trusted `source_id`, reads the preserved source text, and extracts zero, one, or multiple event candidates. It does **not** perform OCR, create/read source chunks, create embeddings, use external knowledge, infer an event year from publication time, infer organizers from page identity, reconcile fuzzy names across sources, or modify chat/RAG. Unsupported scalar facts remain `null`. The model is instructed to return facts and exact excerpts only, never hidden reasoning or chain-of-thought.

The shared contract and validator are in [`supabase/functions/_shared/extraction.ts`](../supabase/functions/_shared/extraction.ts). Every asserted fact requires an exact source substring. Aliases require excerpts containing each alias. Fee classification requires conservative fee-language evidence, and a fee value must occur in a fee excerpt. Unsupported alias/fee assertions are removed and route the result to review. Enums, HTTP(S) URLs, year range, timestamp offsets, end-before-start, and Asia/Manila year consistency are checked at runtime. Local timestamps must include an offset and evidence with an explicit local time; date-only evidence remains a null datetime rather than inventing midnight. The validator stores complete timestamps as their equivalent ISO instant. `FREE` and unknown fees are distinct.

## Persistence and review

Phase 6 has three deployed migrations, which must remain in order. Migration [`supabase/migrations/006_knowledge_extraction.sql`](../supabase/migrations/006_knowledge_extraction.sql) adds the extraction schema, service-only RPCs and review view; canonical `events.event_name` stays non-null while unsupported event facts become nullable. State is unique by `(source_id, source_fingerprint, extractor_version)` and records explicit status, attempts, errors, result JSON, review reasons, and timestamps. Migration [`supabase/migrations/007_fix_extracted_event_audit_current.sql`](../supabase/migrations/007_fix_extracted_event_audit_current.sql) converts `events.is_current` from the Phase 2 status-generated column into an independently writable boolean with a `true` default so prior-fingerprint rows can remain as non-current audit history without changing their event status. Migration [`supabase/migrations/008_sync_event_current_status.sql`](../supabase/migrations/008_sync_event_current_status.sql) restores canonical status-to-current synchronization while preserving old extraction fingerprints as inactive rows.

Candidate identity is deterministic: source ID + exact fingerprint + extractor version + candidate array index. This deliberately avoids unsafe fuzzy cross-source reconciliation. A changed source fingerprint creates a new extraction state and new candidate identities. During atomic persistence, only older extractor-derived events for that exact source are marked `is_current=false`; they remain as audit history and cannot remain actively retrievable beside replacements. No cross-source record is touched. Persistence rechecks the current fingerprint while locking the source. Exact `event_sources` rows preserve provenance. A null candidate name is retained in result JSON for review but is never inserted into `events`. Cancellation and postponement add a `schedule_change` review hint.

`source_extractions`, its RPCs, and the review view are service-role only. Migration 006 also removes the historical public read policy from `source_chunks`; Workflow B has no chunk access. Migrations 007 and 008 are ordered forward fixes for extracted-event currentness and status synchronization; they are intentionally retained as separate deployed migrations.

## Secure endpoint and retry ownership

[`supabase/functions/extract-source/index.ts`](../supabase/functions/extract-source/index.ts) requires a server-only `x-extraction-token` checked in constant time, then uses the service role internally. Neither credential belongs in a browser or workflow export. It loads only the requested eligible active source, atomically claims fingerprint/version state with a unique owner token and bounded lease, asks `GEMINI_MODEL` for structured JSON, validates evidence, and calls an owner-checked atomic persistence RPC. A concurrent invocation receives `processing` without calling Gemini; an expired lease can be reclaimed.

The Edge Function owns at most three transient attempts for HTTP 429, 500, 502, 503, 504, fetch/network failure, or its 90-second timeout. HTTP 400/401/404, malformed JSON, unsupported evidence, invalid enums, and deterministic validation failures are never retried. n8n does not retry, preventing nested retry amplification. The default is the supported `gemini-flash-latest` alias; `GEMINI_MODEL` can pin another compatible model. Upstream failures log only model, HTTP/provider status, retry timing, and request ID—never keys, tokens, prompts, source text, or provider response bodies. Permanent schema/evidence/model errors are recorded as `permanent_error`; exhausted transient errors become `retryable_error`.

For acceptance only, the function contains versioned, exact-input `extraction-test-*` outputs. This path is disabled by default and activates only when `EXTRACTION_ACCEPTANCE_FIXTURE_TOKEN` is configured to a non-empty value different from `EXTRACT_SOURCE_TOKEN`, and a request passes both server-only tokens. It accepts no extraction payload: the source must already exist, have an exact compiled fixture post ID, and byte-match its compiled source text (including the one compiled edit case). Missing/wrong fixture authorization or any non-exact source always follows the strict Gemini production path. Remove the acceptance secret after upstream acceptance or keep it absent in normal operation.

The checked-in [`supabase/config.toml`](../supabase/config.toml) sets `verify_jwt=false` only for `extract-source`, because n8n does not possess a Supabase JWT and the function enforces its own token before privileged work. Configure secrets out of band, then deploy in the approved deployment phase with `supabase functions deploy extract-source --no-verify-jwt`. Do not place token values in the repository.

## Workflow B

Import [`n8n/workflows/buglasan-knowledge-extractor.json`](../n8n/workflows/buglasan-knowledge-extractor.json), configure `SUPABASE_URL` and `EXTRACT_SOURCE_TOKEN` in n8n's server environment, and replace the placeholder webhook Header Auth credential with a secret n8n credential before activation. Callers must provide that independently managed webhook credential; it may be different from the function token. The artifact is inactive and contains no secret values. It is independent of Workflow A: its authenticated webhook receives `{ "source_id": "uuid" }`, calls the trusted function once, accepts non-2xx response bodies without node failure, then branches on compact status.

## Local checks

Run:

1. `npm test` — contract, malformed JSON/evidence/enum/timestamp, migration, endpoint resilience, Workflow B, existing collector, and RAG-focused tests.
2. `npm run typecheck`
3. `npm run build`
4. `npm run lint`
5. `npm run check:extraction-json`

Fixtures A–I are deterministic text inputs in [`test/fixtures/extraction-test-cases.json`](../test/fixtures/extraction-test-cases.json): complete, partial, explicit 2027 versus publication 2026, ambiguous year, no event, free versus unknown fees, cancellation, multi-event, and malformed/ambiguous.

## Guarded live acceptance (do not run casually)

The harness [`scripts/knowledge-extraction-live.ts`](../scripts/knowledge-extraction-live.ts) requires all server variables, an exact `SUPABASE_EXPECTED_PROJECT_REF` match, and `LIVE_KNOWLEDGE_EXTRACTION_TEST=I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION`. Tests 1–9 insert only deterministic `extraction-test-*` sources, invoke the production-secured endpoint, assert each requested status, and query extraction/event/link counts and identities scoped to the returned fixture source ID. Test 10 ingests the exact same unchanged source, invokes the endpoint again, and proves state/event/link identity is unchanged. It then edits that same source and proves one new fingerprint state replaces old active output source-locally.

Run acceptance only after migration/function deployment in the separately approved deployment phase: `npm run extraction:acceptance`. Cleanup is intentionally separate: `npm run extraction:cleanup`. Cleanup first resolves only sources whose `post_id` starts with `extraction-test-`, verifies that invariant, deletes only events whose `extracted_source_id` is one of those exact IDs (required by the restrictive event FK), then deletes only those source IDs; cascades remove their extraction state/provenance. It never performs a broad production delete.
