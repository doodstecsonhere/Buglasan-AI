# Phase 5 Source Ingestion

## Boundary

The Source Collector validates, normalizes, and atomically upserts one row in `sources`. Source collection and knowledge extraction are separate stages. This collector does **not** interpret events and does not perform Facebook fetching, OCR, chunking, embedding, event creation, reconciliation, or supersession.

Adapters—temporary manual input today and future Meta Graph API/admin-export adapters—must end at the same canonical payload. They own transport mapping only; the shared validator and database RPC own the contract.

## Canonical payload

All keys are required so unknown values are explicit `null`, not omitted.

| Field | Meaning |
| --- | --- |
| `platform` | Exactly `facebook` in Phase 5. |
| `post_id` / `post_url` | Stable Facebook identity; non-empty ID and HTTP(S) URL. |
| `published_at` | RFC 3339 timestamp with timezone, or `null` when unavailable. |
| `post_year` | Publication calendar year in `Asia/Manila`. With `published_at`, canonical TypeScript and the DB override it with the timestamp's Manila civil year; otherwise a 1900–2100 integer or `null` is preserved. |
| `festival_year` | Explicit festival year, 1900–2100 integer or `null`; never inferred from publication date or text. |
| `raw_text` | Original text preserved exactly, or `null`. |
| `normalized_text` | Adapter-supplied normalized text or `null`; not synthesized here. |
| `title` | String or `null`. |
| `source_type` | `text`, `image`, `video`, `link`, `mixed`, or `unknown`. |
| `media_urls` | HTTP(S) URL array; order and duplicates are preserved and significant. |
| `collected_at` | Required RFC 3339 collection timestamp with timezone. |
| `collection_method` | `manual`, `meta_graph_api`, `admin_export`, or `other`. |
| `source_metadata` | Arbitrary JSON provenance object. |

Image-only records may have both text fields `null` when media URLs or metadata provenance remains. Text-null/media-empty/metadata-empty payloads are rejected. Unknown `festival_year` stays `null`, preventing exact/current-year retrieval.

Fixtures in `test/fixtures/source-ingestion.json`: A is 2026 text; B is a December 2026 post explicitly concerning 2027; C has unknown festival/publication data; D is image-only; E edits A.

## RPC and idempotency

`ingest_source(p_payload jsonb)` is the only collector write boundary. It revalidates fields, derives `post_year`, calculates a DB-owned SHA-256 fingerprint, and safely serializes concurrent operations around unique `(platform, post_id)`.

The fingerprint covers ingest-relevant semantic fields, including ordered media and metadata, but excludes `collected_at`, `ingested_at`, and `updated_at`. JSONB canonicalizes object-key order while preserving array order.

- New identity: `inserted`, `changed=true`.
- Same fingerprint: `unchanged`, `changed=false`; collection time and server timestamps remain untouched.
- Changed semantics: `updated`, `changed=true`; mutable collector fields and `updated_at` change while UUID, lifecycle/history fields, and initial `ingested_at` remain.

Backfilled existing rows retain a null fingerprint; their first collector replay establishes it as one semantic update.

## Security

The RPC is `SECURITY DEFINER` with fixed search path and UTC timezone. Execution is revoked from public, `anon`, and `authenticated`, and granted only to `service_role`. Existing RLS and public source-read intent remain. Never expose `SUPABASE_SECRET_KEY` to a browser, caller, export, log, or repository. Secret keys retain service-role database access; the database role and permissions are unchanged.

## n8n

Import `n8n/workflows/buglasan-source-collector.json`. Configure server environment variables `SUPABASE_URL` and `SUPABASE_SECRET_KEY`; no secret values are exported. The RPC request sends the secret key only in `apikey`, not as a bearer JWT. The nodes are Webhook → Normalize → Validate → HTTP RPC → Inspect → Respond. The exported workflow is deliberately inactive and its webhook uses n8n Header Auth, referenced as `Buglasan Source Collector Header Auth`, before any node that can access the service-role-backed RPC.

One-time setup: in n8n, create a **Header Auth** credential with a private, randomly generated header name/value agreed with the authorized caller, then select that credential on **Source Webhook** (replace/resolve the imported reference if n8n prompts). Store the value only in n8n's credential store and the authorized caller's secret store—never in workflow JSON, environment documentation, logs, browser code, or this repository. Verify an unauthenticated request is rejected by n8n and an authenticated test request reaches validation before considering activation. **Do not activate this workflow until the Header Auth credential and both server-side Supabase variables are configured and the unauthorized-request check passes.** Never place the Supabase secret key in the inbound credential; callers receive only the separate webhook credential.

## Fixture acceptance and cleanup

The live harness requires variable names `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_EXPECTED_PROJECT_REF`, and explicit `LIVE_SOURCE_COLLECTOR_TEST`. It never prints credential values and rejects project-ref mismatch.

After migrations through 005 are applied, run `npm run source:acceptance`; use `npm run source:cleanup` for separate cleanup. Tests 1–6 insert A, replay A with collection-time noise, insert/verify B–D, then edit A with E. The harness checks RPC operations, count, UUID/initial timestamp, nulls, year separation, image media, fingerprints, and edit timestamp. Its `finally` cleanup deletes only four fixed `ingestion-test-` identities and never touches chunks or events.
