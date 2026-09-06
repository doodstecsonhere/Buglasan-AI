# Phase 9 orchestration

The inactive n8n workflows are deliberately separate contracts: A is the authenticated source collector, B invokes extraction, C invokes semantic indexing, and D invokes reconciliation. A asks the service-only `get_orchestration_dispatch` RPC for the lifecycle plan after ingestion. A dispatches B and C independently when the source changed; an unchanged request is limited to incomplete, processing/reclaimable, or retryable lifecycle work.

B only asks the same planner for current, complete, review-free candidate IDs after an `extracted` result, then makes one bounded D invocation per returned candidate. The planner owns all eligibility decisions; n8n never accepts a caller-provided candidate list. Every inbound webhook uses Header Auth, every internal handoff uses an environment-backed orchestration token, workflows remain inactive, and no workflow has retry loops.

[`npm run pipeline:status`](../package.json) is the official service-key-only operational read of `orchestration_status`; it performs no mutations. [`npm run orchestration:status`](../package.json) remains a compatibility alias.
# Phase 9 orchestration safeguards

The service-only planner uses the current processor configurations: extraction [`phase6-v1`](../supabase/functions/extract-source/index.ts:11), semantic indexing [`semantic-index-v1`](../supabase/functions/_shared/chunking.ts:1) with [`gemini-embedding-001`](../supabase/functions/_shared/embedding.ts:2), and reconciliation [`reconciler-v1`](../supabase/functions/_shared/reconciliation.ts:1). Active, unexpired leases are not dispatched again; expired leases and retryable work are reclaimable.

Each planner result contains at most 25 deterministic candidate IDs, plus `has_more_candidates` and `remaining_candidate_count`. Workflows A and B validate planner HTTP/schema results before responding exactly once with an acknowledgement; downstream dispatch occurs afterward and is intentionally non-blocking.

## Acceptance-only live capability

[`npm run pipeline:acceptance`](../package.json) is a guarded production-write acceptance capability, never part of regression checks. It requires the exact `LIVE_PIPELINE_ACCEPTANCE_TEST=I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION` opt-in, an expected Supabase project-ref match, distinct worker and fixture tokens, and deployed [`cleanup-pipeline-acceptance`](../supabase/functions/cleanup-pipeline-acceptance/index.ts:1).

The fixture family is fixed to `pipeline-test-*`, marked with the exact `pipeline_acceptance_fixture: phase9-v1` ownership marker, and cleaned exclusively by [`014_pipeline_acceptance_cleanup.sql`](../supabase/migrations/014_pipeline_acceptance_cleanup.sql). Cleanup has no caller-selected IDs, uses constant-time token comparison at the Edge boundary, is service-role-only at the RPC boundary, deletes only the fixed family, and refuses deletion whenever its canonical graph is shared.

The harness calls real deployed `ingest_source`, `extract-source`, `index-source`, `reconcile-event`, and `chat` interfaces. A/B/C/D n8n workflows remain intentionally inactive: their JSON contracts are validated statically and the harness does not claim their webhooks executed. Gemini/provider unavailability is reported as an external blocker without retry hammering. [`npm run pipeline:cleanup`](../package.json) runs the trusted cleanup and the independent zero-remains audit.
# Phase 10 note

Extraction eligibility accepts current source lifecycle states `active`, `updated`, and `postponed`; `superseded`, `cancelled`, and `archived` remain ineligible. This is aligned with the Phase 9 planner and indexing contract.
