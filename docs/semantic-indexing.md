# Semantic indexing (Workflow C)

Workflow C turns eligible stored sources into retrieval-current Gemini vectors. It does not perform OCR, infer festival years, or use an LLM for chunking. Eligible source states are `active`, `updated`, and `postponed`; trimmed `normalized_text` takes precedence over trimmed `raw_text`. Image-only records enter review and other textless records become `no_text`. Explicit test metadata is rejected except through the separately authorized, exact `indexing-test-*` acceptance path.

## Versioned content contract

`semantic-index-v1` normalizes line endings, NBSP and horizontal whitespace, then deterministically packs paragraphs toward 1,200 UTF-16 characters with a 1,600 hard maximum and no overlap. Oversize paragraphs use punctuation boundaries, then late spaces, then hard cuts. Each exact chunk has a lowercase SHA-256 hash. Identity is UUIDv5 of `source_id:fingerprint:indexer_version:chunk_index`. Any chunking, normalization, model, dimensions, or vector-normalization change requires a version bump.

Gemini `gemini-embedding-001` output is exactly 768 finite dimensions and is strictly L2-normalized. Documents use `RETRIEVAL_DOCUMENT`; chat queries retain `RETRIEVAL_QUERY`. Contract failures are permanent; 429, selected 5xx, network failures, and timeout are retryable with three bounded attempts.

## Atomicity, temporal integrity, and operations

`source_indexings` preserves every fingerprint/version attempt. A claim token and 30–300 second lease serialize workers. Persistence locks and rechecks the source fingerprint, validates all chunks before mutation, preserves deterministic replay, and switches current chunks in one transaction. A successful zero-chunk result also retires stale chunks. Historical chunks remain audit rows. Retrieval requires current chunks joined to a current, eligible source and uses the authoritative source year; SQL equality excludes null years.

Review `indexing_review_queue` for image-only, retryable, and permanent outcomes. Retry transient rows by invoking Workflow C again; expired leases are reclaimable. Logs and responses contain safe codes only. Rollback should stop invocations/function traffic first; historical rows support diagnosis, and current chunks remain unchanged after failed replacement.

## Security and setup

The Edge Function has JWT verification disabled because its constant-time `x-index-source-token` check is the boundary. Keep `INDEX_SOURCE_TOKEN`, `INDEXING_ACCEPTANCE_FIXTURE_TOKEN`, `GEMINI_API_KEY`, `SUPABASE_SECRET_KEYS`, and n8n Header Auth credentials secret and distinct. Tables, RPCs, and review view are service-role-only. Import the inactive Workflow C artifact, attach Header Auth, configure `$env.SUPABASE_URL` and `$env.INDEX_SOURCE_TOKEN`, apply migration 009, then deploy `index-source`. Do not activate until reviewed.

## Verification and guarded acceptance

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run check:indexing-json`. Live acceptance additionally requires all server variables, the exact expected project reference, and `LIVE_SEMANTIC_INDEXING_TEST=I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION`. It covers six cases: short text, deterministic multi-chunk, null-year exclusion, zero-text classifications, replay/concurrency, and edit/failed replacement. Cleanup is separate and must first resolve and verify only returned source IDs whose post ID starts `indexing-test-`; never perform an unscoped delete.
