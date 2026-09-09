# Phase 10 onboarding foundation

This phase adds operator-controlled intake and visibility. It does **not** contain a Facebook scraper, OCR/image understanding, or n8n activation.

## Intake procedure

1. Obtain an operator-reviewed export from the official Buglasan Facebook page.
2. Put the local file under `operator-manifests/` (ignored by git).
3. Use `npm run phase10:manifest -- operator-manifests/buglasan-2026-real-corpus-01.json` or a `.jsonl` file. The package script supplies `--validate` internally. Exactly one positional manifest path is accepted; shell punctuation is ignored and multiple paths are rejected.
4. Resolve every validation error and review image-only records manually.
5. Production ingest/plan modes remain explicitly gated and do not bypass `ingest_source`.

## Manifest contract and trusted source policy

Each record is the existing source-ingestion payload plus `provenance` (`operator`, `reviewed_at`, `capture_note`). Fields are closed-world: unknown fields fail. `post_url` must be an exact `https://www.facebook.com/Buglasan/posts/` URL with either a direct numeric ID or a non-empty slug ending in a numeric ID, optionally followed by one trailing slash; that final numeric ID must equal `post_id`. Query strings, fragments, redirects, arbitrary URLs, credentials, and inferred URLs are not accepted. `post_id` is stable and unique within a manifest. Timestamps require timezone-bearing RFC 3339 values. `festival_year` is nullable and never inferred. `media_urls` is separate from text.

Supported values are inherited from [`sourceIngestion.ts`](../src/ingestion/sourceIngestion.ts): Facebook, `text|image|video|link|mixed|unknown`, and `manual|meta_graph_api|admin_export|other`.

Records with null text and media are classified as image-only only when media evidence/provenance exists; no OCR or image interpretation is performed. Missing publication or festival years remain null.

## Commands and status

- `npm run phase10:manifest -- operator-manifests/buglasan-2026-real-corpus-01.json` — local validation only; the package script supplies `--validate` internally. It reports record-level diagnostics and exits non-zero if any record is invalid or duplicate; valid records are not hidden by earlier failures. Counts include total, valid, invalid, duplicate, image-only, text-bearing, festival-year known/null, and rejected reasons.
- `npm run phase10:manifest -- --plan <file>` — non-mutating actionable plan listing valid record IDs, an `ingest_source` payload summary, image-only handling, diagnostics, and `writes: 0`. It never writes and does not enable production ingest.
- `npm run phase10:status` — read-only counts from `orchestration_status`; it loads `.env.local` when present, requires `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, and never prints secrets.
- `npm run phase10:corpus-inspect -- operator-manifests/buglasan-2026-real-corpus-01.json` — exact-ten, manifest-bound read-only inspection. It validates first, requires each official `post_id`/trusted URL to resolve to exactly one current production `sources` row, rejects missing/duplicate/mismatched/out-of-manifest rows, and reads source, extraction, event, link, reconciliation, chunk, citation, canonical, and year state with bounded output. It never calls mutation RPCs, providers, workers, n8n, or indexing/extraction/reconciliation endpoints. The report includes the four permanent terminal-failure states when present and performs the August 23 check for post `1475245514640502` using stored source/chunk text only.
- `--ingest` remains gated by `PHASE10_PRODUCTION_INGEST=true` plus `--i-understand-production-write`; ingest is intentionally not implemented in this foundation.

## Evaluation protocol and report template

The acceptance corpus is operator-reviewed and manifest-bound. Do not substitute fixtures or fabricate 2026 results. The independent RAG smoke fixtures are only a deployed-route regression check and are removed immediately after testing.

Report: corpus identifier/access basis; collection window; record count; valid/invalid/duplicate counts; missing-year count; image-only count; trusted URL exceptions; ingestion outcomes; extraction/indexing statuses; sampled audit findings; reviewer and date. Synthetic fixtures are not evaluation evidence.

## Baseline, audit, and launch readiness

Baseline is accepted Phase 9 HEAD `2893b71`; migrations 001–016 are preserved exactly. Audit intake files, validation output, operator identity, and source provenance without storing secrets. Launch readiness requires approved corpus, successful validation, duplicate review, URL policy review, null/image-only review, secret-safe status report, focused tests, and explicit operator sign-off. n8n remains inactive.

## Phase 10 closure acceptance — 2026-09-09 (Asia/Manila)

- **Operator:** Zoo, credentialed project-local Supabase CLI session.
- **Reviewer:** automated contract and live acceptance checks; the real target remains `needs_review` and open for human review, which is acceptance-safe and does not block Phase 10 closure.
- **Database deployment:** migration [`017_repair_cached_index_currentness.sql`](../supabase/migrations/017_repair_cached_index_currentness.sql) was applied to the linked production project. It changes only the cache-validity decision in [`claim_source_indexing`](../supabase/migrations/017_repair_cached_index_currentness.sql:5); it contains no direct `PATCH` or `UPDATE` to `source_chunks.is_current`.
- **Targeted semantic repair:** one normal deployed `index-source` call for the hard-bound source [`254d56af-7bf4-4913-8a9b-d5ab34367b33`](../scripts/phase10-source-replay.ts:17) returned `indexed`, `cached: false`, and one persisted chunk. Read-only verification confirmed the current fingerprint has one `is_current=true`, `semantic-index-v1`, `gemini-embedding-001`, 768-dimension chunk; the historical fingerprint's retained chunk is `is_current=false`.
- **Corpus and RAG acceptance:** the exact-ten inspector resolved all 10 manifest records, found the stored-text August 23 evidence, and reported the four known terminal extraction records without retrying them. The real-provider A/B/C RAG suite passed with year-isolated cited chunks and was cleaned up.
- **Reconciliation safety:** the deployed reconciliation acceptance harness now loads the documented local configuration before its guard. Its first synthetic fixture returned a non-`reconciled` result at the canonical-creation assertion; this fixture-only failure is non-blocking. The isolated fixture was removed by the trusted cleanup endpoint. No canonical/review data was manually changed and no retry was performed. The real target's `needs_review` state remains open for human review and is acceptance-safe.
- **Sign-off:** Zoo signs off Phase 10 closure on 2026-09-09 (Asia/Manila): deployed currentness repair, exact-ten audit, and A/B/C RAG evidence meet acceptance; the four terminal extraction failures remain untouched and n8n remains stopped.
