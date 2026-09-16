# Image Source Inbox

## Access and boundary

The Source Inbox is a **local, trusted operator-only library boundary**, not a public PWA capability or deployed endpoint. Invoke [`analyzeSourceInbox()`](../src/ingestion/sourceInbox.ts:136) only from an operator-controlled runtime that already holds user-selected image bytes; provide its preview to an operator, then call [`approveSourceInboxPreview()`](../src/ingestion/sourceInbox.ts:160) after an explicit decision. No browser credential, server secret, public route, database table, migration, or separate persistence path is introduced.

Only an HTTPS official `facebook.com/Buglasan` post reference, an optional operator caption, and 0–8 local JPEG, PNG, or WebP images up to 8 MiB each are accepted. MIME declaration and binary signature are both checked. Empty, malformed, unsupported, oversized, credential-bearing, non-HTTPS/non-Facebook, and non-Buglasan references are rejected. This fixed Buglasan boundary is not a generic-event configuration path. The inbox never fetches, scrapes, downloads, parses Facebook pages/oEmbed/DOM, or processes video.

## Analyze, preview, approval, and failures

Analysis is non-mutating. The preview preserves the original operator caption separately from each image's hash/size/type/validation result, plus provider ID/version/method/time/confidence/review state, OCR text state/text, and vision observations. The included deterministic local provider emits `unknown` OCR rather than pretending that no text exists. Provider failures are retained per image, so valid sibling images remain reviewable. Reference-only submissions are previewed but cannot be approved.

Approval maps the preview through the existing adapter and [`ingestGenericCollectorRecord()`](../src/ingestion/genericCollectorIngress.ts:102), whose supplied trusted dispatcher must ultimately use the established `ingest_source` owner. Image bytes are never uploaded by this capability; only hash-based evidence/provenance is forwarded. The deterministic replay key makes an identical reference/caption/image set produce a stable collector identity. The existing collector fingerprint determines whether approval is an insert, update, or no-op replay.

## Freshness and future media

Analysis, failed validation/provider work, reference-only previews, and unchanged replays do not call the collector and therefore cannot advance knowledge-base freshness. Only a changed, approved source accepted by the existing pipeline is eligible to affect downstream freshness according to existing semantics.

[`MediaAnalysisProvider`](../src/ingestion/sourceInbox.ts:48) has an optional video seam for a future trusted workflow, but video remains rejected and no video implementation, live AI provider, deployment, n8n activation, or production mutation is part of this checkpoint.
