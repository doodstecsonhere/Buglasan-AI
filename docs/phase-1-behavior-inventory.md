# Phase 1 behavior inventory and configuration boundary

## Scope and baseline

Phase 1 starts from `83ad8ebae8516a5e9825c8bcc89901ccfec994bb` on `main` tracking `origin/main` (verified `0/0` ahead/behind). Gate B ancestor `f4a506ade22d15ad74ed5b6e09253c366418db6b` is accepted evidence and was not rerun. This phase only introduces a checked-in, immutable, runtime-validated browser product configuration and replaces equivalent literals in bounded consumers. It makes no deployment, database, webhook, ingestion, retrieval, freshness, or protected-pipeline behavior change.

The boundary is `src/config/productConfig.ts`. It is intentionally static: no `import.meta.env`, `Deno.env`, tenant override, remote mutation, or demo fixture populates it. `defineProductConfig()` validates a complete exact own-key schema (including non-enumerable and symbol keys), rejects duplicate browser-language prefixes, and deep-freezes every reachable own value before use. Public source URLs must use credential-free HTTPS without query strings or fragments. A defense-in-depth check rejects demo markers and recognizable credential/token indicators; it is not a claim that arbitrary secrets can be detected mathematically. The browser boundary is not imported into Deno Edge Functions or n8n JSON; those runtimes currently duplicate relevant constants intentionally and are deferred to their classified phases rather than coupled to Vite application code.

## A — Phase 1 extract

- `src/App.tsx`: preserves the six-message outbound history cap, 2,000-character composer maximum, `Buglasan AI` offline sentence, `Buglasan Festival` composer placeholder, and browser-language order (`fil`/`tl`, then `ceb`, otherwise `en`) through configuration values. The exact `BUGLASAN AI` wordmark remains a literal because the existing production-branding guard intentionally scans the source shell; the same value is recorded in configuration for later branding consumers.
- `src/components/ChatInterface.tsx`: preserves `/icons/icon-192.png`, “Buglasan”/“Buglasan Festival” empty-state copy, and official-source wording.
- `src/components/AIDisclaimer.tsx`: preserves the exact AI disclaimer, official Facebook URL and label, and exact non-affiliation statement.
- `src/components/FacebookBadge.tsx`: preserves the exact official Facebook destination, visible “Official Buglasan Festival Facebook Page”, and matching accessible label.
- `src/utils/dateUtils.ts`: preserves `Asia/Manila`, `en-US` clock conversion, `en-PH` display, accepted explicit years 2020–2030, calendar-year default, and the typical October 15–25 range.
- `src/utils/chatThreads.ts`: preserves local-storage key `buglasan-ai.chat-threads.v1` and the 48-character title truncation plus ellipsis.
- `src/utils/installPrompt.ts`: preserves local-storage key `buglasan-install-dismissed`.
- `src/services/offlineKnowledge.ts`: preserves IndexedDB database `buglasan-ai-offline-knowledge`, store `verified-snapshots`, version `1`, six-event answer cap, Manila date matching, Philippine display locale, and official Facebook fallback URL.
- `src/config/productConfig.ts`: additionally records minimum product description, aliases/vocabulary, deterministic language labels, authority/source identity, event-cycle semantics, browser branding references, and stable namespace. These are data declarations only; they do not broaden retrieval matching or add runtime override behavior.

## B — Phase 2 PWA branding (deferred)

- `public/manifest.webmanifest`: name/short name `Buglasan AI`, multilingual/year-aware description, root id/start/scope, `#07174F` theme/background, icon paths, `en-PH`, and categories remain static and untouched.
- `index.html`: description, application/Apple title, Open Graph title/description/image/locale, favicon paths, theme color, and document title remain static and untouched.
- `public/service-worker.js`: cache name `buglasan-ai-shell-v5-offline-knowledge` and shell/icon paths remain untouched; coupling service-worker cache migration to browser config would be unsafe.
- `public/offline.html`: standalone offline copy/branding remains untouched.
- `tailwind.config.js`: the `fiesta` palette, neutral palette, fonts, and animations remain untouched. Theme-token migration is not Phase 1.

## C — Phase 3 generic RAG policy (deferred)

- `supabase/functions/chat/index.ts`: `SYSTEM_PROMPT`, 2020–2030 server year parser, six-message server history slice, `CONTEXT_LIMITS` (8 sources, 10 events, 15 chunks, 0.7 thresholds), temporal parsing, language instructions, zero-evidence routing, and citation prompting remain untouched.
- `supabase/functions/chat/grounding.ts`: exact official-Facebook post URL policy, supported-language intent regexes, festival-scope vocabulary, fallback wording, citation validation, and lexical stop words remain untouched.
- `src/services/demoChatResponder.ts`: demo-only intent regexes, fixture-derived wording, and event formatting remain untouched. Production demo isolation remains owned by `src/services/chatService.ts`, where production cannot re-enable fixtures and missing live endpoint configuration fails instead of selecting demo data.

The server duplicates assistant identity, languages, timezone, official URL, and year bounds for now. Sharing the Vite module with Deno would introduce a cross-runtime build/deployment dependency; consolidation belongs to a separately designed server configuration boundary, not this extraction.

## D — Phase 4 freshness (deferred)

- `src/services/offlineKnowledge.ts`: existing cache `savedAt` display and “It may be stale” warning are preserved, but no TTL, freshness rank, refresh scheduler, or currentness mutation is added.
- `supabase/functions/chat/index.ts`: current-year, status, supersession, publication-date, and retrieval ordering logic remain untouched.
- `supabase/functions/_shared/reconciliation.ts`: status/current-version lifecycle and date relationship behavior remain untouched.

## E — Phase 5 source adapters (deferred)

- `src/ingestion/sourceIngestion.ts`: remains Facebook-only (`platform: 'facebook'`) with manual/Meta Graph/admin-export/other collection methods, HTTP(S) URL checks, RFC 3339 timestamps, and Manila-derived `post_year`; no adapter is added.
- `n8n/workflows/buglasan-source-collector.json`: authenticated source webhook, canonical payload validation, Supabase ingestion RPC, and downstream B/C/D dispatch remain untouched.
- `n8n/workflows/buglasan-knowledge-extractor.json`, `buglasan-semantic-indexer.json`, and `buglasan-event-reconciler.json`: exact-ID authenticated webhook contracts and function dispatches remain untouched. Environment references remain runtime secrets in n8n and never enter browser product configuration.

## F — intentionally Buglasan-specific

- Product identity, official Buglasan Facebook page, Negros Oriental description, non-affiliation wording, Buglasan aliases, October 15–25 typical range, and existing `buglasan-*` persisted identifiers are deliberately retained.
- `supabase/functions/chat/grounding.ts` requires Facebook citation paths under `/Buglasan/posts/.../`; generalizing authority/domain policy could change trust behavior and is explicitly not Phase 1.
- `supabase/functions/_shared/extraction.ts` interprets timestamps and candidate `festival_year` in `Asia/Manila`, requires exact evidence excerpts, and uses fixed event/status/fee enums. These domain safeguards remain intentionally specific.
- `supabase/functions/_shared/reconciliation.ts` uses Manila civil-day comparison and fixed deterministic matching gates. It remains intentionally specific.
- Existing synthetic data and demo responder copy remain clearly demo-only and are not copied into `productConfig`.

## G — proven core untouched

- No file under `supabase/functions/`, `supabase/migrations/`, `n8n/workflows/`, or `scripts/` is modified.
- No PWA manifest, service worker, offline page, HTML metadata, Tailwind theme, package script, package dependency, lockfile, chat service production/demo gate, message renderer, source card, ingestion contract, extraction validator, reconciliation algorithm, retrieval policy, or database schema is modified.
- Protected live operations were not invoked: no acceptance/live script, production webhook, migration, deployment, cleanup, Gate B run, commit, or push.

## Validation mapping (P1–P12)

`src/config/productConfig.test.ts` maps P1–P12 to identity; language determinism; trust/source hooks; regional and cycle behavior; branding and limits; persistence stability; deep immutability across all own keys; required/unknown own-key rejection; genuine locale/timezone checks; safe IDs/namespaces/paths/public URLs; range/language-prefix/limit invariants; and rejection of demo markers and recognizable credential/token indicators. Existing consumer tests continue to prove the original storage keys, title truncation, date behavior, offline database behavior, and production demo separation.
