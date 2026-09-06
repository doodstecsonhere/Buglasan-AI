# Event reconciliation

Phase 8 reconciles immutable Phase 6 candidate observations into versioned canonical events. The implementation is in [`011_event_reconciliation.sql`](../supabase/migrations/011_event_reconciliation.sql), the trusted worker is [`index.ts`](../supabase/functions/reconcile-event/index.ts), and the inactive n8n entry point is [`buglasan-event-reconciler.json`](../n8n/workflows/buglasan-event-reconciler.json).

## Operational boundaries

- A request accepts only one UUID `candidate_event_id` and requires the server-only `x-reconcile-event-token` header.
- Matching is exact-year only. Candidate records are never updated by reconciliation.
- The worker claims a leased run, applies deterministic matching, optionally asks Gemini only to classify a bounded ambiguity, then resolves through the service-only RPC.
- Malformed Gemini responses, answers outside the shortlist, and non-retryable provider responses fail closed to review. Transient provider statuses return `retryable_error` with `provider_unavailable`; no key, prompt, or raw response is exposed.
- Canonical versions and audit/provenance records are append-only. Reviews require a future operator workflow; this Phase 8 endpoint does not grant browser access.

## Retrieval behavior

[`get_festival_events()`](../supabase/migrations/011_event_reconciliation.sql:225) reads only the latest canonical version for the requested festival year. Scheduled, confirmed, postponed, and cancelled canonical states are discoverable when their status is requested. This lets chat surface the latest cancellation or postponement rather than presenting a stale schedule. The chat retrieval request includes those statuses while retaining exact-year filtering.

## n8n workflow

Import Workflow D manually and keep it inactive until operational approval. Configure its header-auth credential separately from `RECONCILE_EVENT_TOKEN`; the workflow passes the latter through an n8n environment expression. It has no database or Gemini node and routes `reconciled`, `needs_review`, `processing`, `retryable_error`, and `permanent_error` responses unchanged.

## Verification

Run deterministic checks with `deno test --allow-env supabase/functions/_shared/reconciliation.test.ts`, `npm test -- --run scripts/event-reconciliation-migration.test.ts scripts/event-reconciliation-live.test.ts scripts/event-reconciliation-workflow.test.ts`, and `npm run check:reconciliation-json`.

The optional Phase 8.1 harness uses only six exact `reconciliation-test-01…06` fixture IDs. It ingests each source, calls deployed `extract-source` using its existing double-gated deterministic fixture protocol, queries candidates by exact generated source ID, then calls deployed `reconcile-event`. Tests 1–12 inspect candidate immutability, canonical/version/provenance/run/review records, source lifecycle separation, identity versus similarity, unknown versus no-event, newest-source non-authority, and replay idempotency. Provider 429, 5xx, timeout, and network failures are surfaced as `provider_unavailable` rather than assertions being misreported as reconciliation failures.

Before running `npm run reconciliation:acceptance` or `npm run reconciliation:cleanup`, deploy migration [`012_reconciliation_acceptance_cleanup.sql`](../supabase/migrations/012_reconciliation_acceptance_cleanup.sql) and the acceptance-only [`cleanup-reconciliation-acceptance`](../supabase/functions/cleanup-reconciliation-acceptance/index.ts) Edge Function. Configure its distinct `RECONCILIATION_ACCEPTANCE_FIXTURE_TOKEN` as an Edge Function secret and provide that same token locally, along with `EXTRACTION_ACCEPTANCE_FIXTURE_TOKEN`. Hosted Supabase project secrets are Edge Function environment variables and do not persist custom PostgreSQL `app.*` settings, so the Edge Function verifies the header token in constant time before it invokes the service-role-only cleanup RPC using the fixed allowlist. The RPC validates that exact allowlist, refuses a shared canonical graph, and deletes only the fully fixture-owned dependency graph in one transaction. The normal append-only triggers remain active outside that transaction. No secret values belong in repository files or logs.
