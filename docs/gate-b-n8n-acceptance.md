# Gate B n8n acceptance

This is the only repository-owned procedure that proves the four n8n workflows executed. It uses the deterministic, clearly synthetic [`gate-b-n8n-acceptance.json`](../test/fixtures/gate-b-n8n-acceptance.json) boundary and the already-deployed, frozen backend interfaces. It never imports workflows, deploys functions, starts or restarts Docker, enables schedules, or changes [`extract-source`](../supabase/functions/extract-source/index.ts:156) automatic reconciliation behavior.

## One-time operator preparation

1. Import the four inactive contracts: [`buglasan-source-collector.json`](../n8n/workflows/buglasan-source-collector.json), [`buglasan-knowledge-extractor.json`](../n8n/workflows/buglasan-knowledge-extractor.json), [`buglasan-semantic-indexer.json`](../n8n/workflows/buglasan-semantic-indexer.json), and [`buglasan-event-reconciler.json`](../n8n/workflows/buglasan-event-reconciler.json).
2. Keep every imported workflow inactive outside the short, attended test window. Bind each unresolved Header Auth placeholder (`configure-after-import` or `PLACEHOLDER`) to a credential named in its workflow. Configure A to require `x-gate-b-acceptance-token`; configure B/C/D to require `x-internal-orchestration-token`. Do not put a token value in workflow JSON.
3. Configure only n8n runtime environment variables referenced by the workflow contracts: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `EXTRACT_SOURCE_TOKEN`, `INDEX_SOURCE_TOKEN`, `RECONCILE_EVENT_TOKEN`, `N8N_INTERNAL_BASE_URL`, and `N8N_INTERNAL_ORCHESTRATION_TOKEN`. No value belongs in source control.
4. In the operator-local ignored [`.env.local`](../.gitignore), set `SUPABASE_URL`, `SUPABASE_SECRET_KEYS` (or `SUPABASE_SECRET_KEY`), `SUPABASE_EXPECTED_PROJECT_REF`, `PIPELINE_ACCEPTANCE_FIXTURE_TOKEN`, `GATE_B_N8N_URL`, `GATE_B_SOURCE_WEBHOOK_TOKEN`, `GATE_B_WORKER_WEBHOOK_TOKEN`, and exactly `LIVE_GATE_B_N8N_ACCEPTANCE=I_UNDERSTAND_THIS_WRITES_SYNTHETIC_GATE_B_FIXTURES`. All three token values must be distinct. The source and worker credentials may use different values while sharing the same header name.
5. Confirm the deployed acceptance-only fixture controls are configured: the deterministic pipeline extraction fixture token differs from the extraction worker token, and the trusted cleanup function is deployed. Do not continue when provider or fixture controls are unavailable.

## Attended live procedure

1. Run [`npm run gate-b:n8n:acceptance`](../package.json). The script first invokes trusted cleanup and verifies that no `pipeline-test-*` source remains.
2. It proves Workflow A Header Auth, source validation, insert/replay idempotence, and same-identity update using the canonical synthetic source.
3. It invokes Workflow B and reads persisted `events` evidence for its terminal deterministic extraction and explicit 2027 year; it then replays B to prove safe terminal/lease behavior.
4. It invokes Workflow C for the text source and replay, then for the text-null image/provenance source and checks persisted `needs_review` evidence. This covers index, replay, explicit year, and null-evidence boundaries.
5. It explicitly invokes Workflow D with the persisted candidate ID and waits for a terminal reconciliation ledger row. This remains explicit orchestration evidence even if the frozen extraction configuration independently performs its existing automatic handoff.
6. The script always invokes trusted cleanup in `finally`, then verifies zero `pipeline-test-*` sources. If it is interrupted, run [`npm run gate-b:n8n:cleanup`](../package.json) with the same guarded local configuration before any rerun.
7. Export or retain the n8n execution IDs and the redacted script output as the Gate B evidence. Deactivate all workflows immediately after the run.

## Expected blockers

Live acceptance cannot be claimed from static tests. It remains blocked until an authorized operator imports the workflows, binds local credentials/environment variables, activates the workflows only for the attended run, and executes the guarded harness against the intended Supabase project. A missing deterministic fixture configuration, unavailable provider, non-terminal lease, or cleanup refusal is a stop condition, not a reason to retry-loop or broaden cleanup.
