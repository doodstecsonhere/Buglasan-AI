# Phase 10 single-source replay

The runner is hard-bound to post `1472636598234727`, source UUID
`254d56af-7bf4-4913-8a9b-d5ab34367b33`, and the trusted manifest
`operator-manifests/buglasan-2026-real-corpus-01.json`. It is not a generic SQL
or mutation tool and does not modify the manifest.

## Invocation

The only supported command shape is:

```text
npm run phase10:source-replay -- 1472636598234727 --execute
```

Without `--execute`, the command is a dry run and emits a redacted plan with
zero writes. `--execute` uses only the existing `ingest_source` RPC and the
authenticated `extract-source`, `index-source`, and `reconcile-event` HTTP
contracts. It requires `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
`PHASE10_OPERATOR_TOKEN`, `EXTRACT_SOURCE_TOKEN`, `INDEX_SOURCE_TOKEN`, and
`RECONCILE_EVENT_TOKEN`; missing configuration fails closed.

Before-images are inspected before execution. A source identity, fingerprint,
or durable downstream state that changes or becomes ambiguous aborts the run.
Canonical ingestion is keyed by `(platform, post_id)` and must return the fixed
source UUID. The runner verifies the resulting fingerprint before invoking the
normal claim/lease-based extraction and indexing functions, each at most once
for its source/fingerprint/version identity. Reconciliation is a decision gate:
only current candidates produced for the verified extraction are submitted,
one request per candidate, and pre-existing active/ambiguous state blocks the
run.

Transport failures after a mutation are reported as `outcome_indeterminate`
and are never retried by a terminal-recovery path. All returned durable state
and errors are redacted before output. Repository validation never invokes the
live runner.
