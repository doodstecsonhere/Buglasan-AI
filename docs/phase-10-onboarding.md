# Phase 10 onboarding foundation

This phase adds operator-controlled intake and visibility only. It does **not** contain a real 2026 corpus, evaluation result, Facebook scraper, OCR/image understanding, n8n activation, or deployment.

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
- `--ingest` remains gated by `PHASE10_PRODUCTION_INGEST=true` plus `--i-understand-production-write`; ingest is intentionally not implemented in this foundation.

## Evaluation protocol and report template

Blocked until an operator supplies a real, access-approved corpus. Do not substitute fixtures or fabricate 2026 results.

Report: corpus identifier/access basis; collection window; record count; valid/invalid/duplicate counts; missing-year count; image-only count; trusted URL exceptions; ingestion outcomes; extraction/indexing statuses; sampled audit findings; reviewer and date. Synthetic fixtures are not evaluation evidence.

## Baseline, audit, and launch readiness

Baseline is accepted Phase 9 HEAD `2893b71`; migrations 001–015 are preserved exactly. Audit intake files, validation output, operator identity, and source provenance without storing secrets. Launch readiness requires approved corpus, successful validation, duplicate review, URL policy review, null/image-only review, secret-safe status report, focused tests, and explicit operator sign-off. n8n remains inactive and no deployment is authorized by this phase.
