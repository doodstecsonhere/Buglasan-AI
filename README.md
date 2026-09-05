# 🎭 Buglasan AI

> A multilingual, year-aware AI companion for the Buglasan Festival of Negros Oriental, Philippines.

[![Built with Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind-4-38B2AC?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)

---

## 📖 Overview

**Buglasan AI** is a festival-aware AI assistant that helps residents, tourists, and participants navigate the **Buglasan Festival** — the official cultural festival of Negros Oriental held annually every October in Dumaguete City.

The AI answers questions in **English, Cebuano/Bisaya, and Filipino/Tagalog**, always grounding responses in official sources and respecting **year-aware retrieval** (it won't confuse last year's schedule with this year's updates).

### Key Features

- 🎭 **Conversational AI** with festival-friendly tone and citations
- 📅 **Year-aware retrieval** — always defaults to current festival year (Asia/Manila timezone)
- 🌐 **Multilingual** — English, Cebuano/Bisaya, Filipino/Tagalog
- 📚 **Source grounding** — every answer links to official Facebook posts / website sources
- 🔄 **Supersession tracking** — venue changes, time updates, and cancellations handled gracefully
- 📱 **Mobile-first PWA** — installable, works offline with cached demo data
- 🎨 **Local festival aesthetic** — vibrant Philippine fiesta color palette
- ⚠️ **Non-intrusive AI disclaimer** — always links to official Facebook page for verification

---

## ⚠️ Demo Data Disclaimer (Synthetic Fixtures)

> **Demo mode uses clearly synthetic fixtures. Real ingestion will replace this data.**

When the app runs with `VITE_DEMO_MODE=true` (the default for development), the chat assistant answers questions using data from [`src/data/demoData.ts`](src/data/demoData.ts). **All of this data is fabricated for demonstration purposes only.** It is not real Buglasan Festival information.

Every `Source.rawText` and `Source.normalizedText` in the demo dataset is prefixed with `[DEMO FIXTURE]` so it can be visually distinguished from real content. Every factual claim (date, venue, organizer, registration deadline, food fair delicacies, history text) is backed by at least one explicit `Source` record, and demo responses derive those claims from the sources rather than from hard-coded strings inside the response generator.

If the demo is asked about something with no backing source (e.g. *"what's the Buglasan 2027 schedule?"* when no 2027 fixtures exist), it returns an honest **"No demo information found"** message rather than fabricating an answer.

The same source-grounding principles apply in production: live responses come from the Supabase `sources` / `events` tables populated by the n8n ingestion pipeline (planned, see [`supabase/functions/chat/index.ts`](supabase/functions/chat/index.ts)). The demo dataset exists only to exercise year resolution, cross-year isolation, supersession handling, temporal filtering, and zero-evidence behavior — not to provide real festival information.

---

## 🏗️ Architecture


```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React PWA)                    │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Chat UI     │  │  Year        │  │  Facebook Badge  │   │
│  │ Components  │  │  Selector    │  │  & Disclaimer    │   │
│  └──────┬──────┘  └──────┬───────┘  └──────────────────┘   │
│         │                 │                                  │
│         └────────┬────────┘                                  │
│                  │                                           │
│         ┌────────▼────────┐                                  │
│         │  ChatService    │ ◄── Demo Mode / Live Mode       │
│         │  (Adapter)      │                                  │
│         └────────┬────────┘                                  │
└──────────────────┼──────────────────────────────────────────┘
                   │
         ┌──────────┴──────────┐
         │                     │
┌────────▼────────┐  ┌─────────▼──────────┐
│  Demo Dataset  │  │  Supabase Edge     │
│  (TypeScript)  │  │  Function (chat)   │
│                │  │  + Gemini API      │
└────────────────┘  └─────────┬──────────┘
                               │
                       ┌─────────▼──────────┐
                       │  Supabase DB       │
                       │  (sources, chunks, │
                       │   events, etc.)    │
                       └────────────────────┘
```

### Tech Stack

| Layer        | Technology                                |
| ------------ | ----------------------------------------- |
| Frontend     | React 19 + TypeScript + Vite              |
| Styling      | Tailwind CSS 4 (custom fiesta theme)      |
| PWA          | Web App Manifest + service worker ready   |
| Backend      | Supabase (Postgres + Edge Functions)      |
| AI           | Google Gemini 1.5 Flash                   |
| Vector Store | pgvector (for semantic search chunks)     |
| Ingestion    | n8n source-only collector workflow        |

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- (Optional) Supabase CLI for local DB
- (Optional) GitHub CLI for repo operations

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/Buglasan-AI.git
cd Buglasan-AI

# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local
# Edit .env.local with your Supabase + Gemini credentials

# Start development server
npm run dev

# Build for production
npm run build
```

The app starts at `http://localhost:5173` in **demo mode** by default (no backend needed).

### Available Scripts

| Command           | Description                                |
| ----------------- | ------------------------------------------ |
| `npm run dev`     | Start Vite dev server with HMR             |
| `npm run build`   | Type-check + production build              |
| `npm run lint`    | Run Oxlint                                 |

Phase 6 evidence-grounded event extraction is documented in [`docs/knowledge-extraction.md`](docs/knowledge-extraction.md). It is a separate, inactive n8n Workflow B and does not add chunks or embeddings.

---

## 🔐 Environment Variables

Copy `.env.example` to `.env.local` and fill in:

| Variable                          | Required | Description                                      |
| --------------------------------- | -------- | ------------------------------------------------ |
| `VITE_SUPABASE_URL`               | Live mode| Your Supabase project URL                        |
| `SUPABASE_PUBLISHABLE_KEY`        | Live mode| Public key explicitly exposed by Vite            |
| `SUPABASE_SECRET_KEY`             | Scripts/n8n | Secret key (trusted server-side only!)        |
| `SUPABASE_SECRET_KEYS`            | Edge fn  | Hosted JSON dictionary; use the `default` entry  |
| `GEMINI_API_KEY`                  | Live mode| Google AI Studio API key                         |
| `GEMINI_MODEL`                    | No       | Override default `gemini-flash-latest`            |
| `GEMINI_EMBEDDING_MODEL`          | No       | Override default `gemini-embedding-001`          |
| `VITE_DEMO_MODE`                  | No       | `true` (default) or `false` to use live backend  |
| `VITE_DEFAULT_FESTIVAL_YEAR`      | No       | Override current-year default                    |
| `VITE_TIMEZONE`                   | No       | Default `Asia/Manila`                            |

⚠️ **Never commit `.env` or `.env.local` to version control.**

---

## 📅 Year-Aware Retrieval

Buglasan AI solves a common chatbot problem: **hallucinating outdated information**.

### Resolution Priority

1. **Explicit year in query** (e.g., "What was the schedule in 2024?")
2. **Relative year expressions** (e.g., "last year", "next year")
3. **Default to current festival year** in Asia/Manila timezone

### Current Festival Year Logic (Corrected)

```typescript
const now = new Date()  // Asia/Manila timezone
// ALWAYS return current calendar year
// Festival occurs in October but year does NOT advance early
currentYear = now.getFullYear()
```

**Key Change:** The festival year now defaults to the **current calendar year in Asia/Manila ALWAYS**, regardless of month.

Examples:
- September 2026 → default **2026**
- October 2026 → default **2026** (NOT 2027)
- November 2026 → default **2026**
- January 2027 → default **2027**

Festival typically runs **October 15–25**.

### Date Resolution & Temporal Filtering

Handles natural language temporal expressions with **server-side filtering** before sending to Gemini:

- **Relative dates**: "today", "tomorrow", "yesterday"
- **Weekends**: "this weekend", "next weekend"
  - *Edge case*: If today is Saturday/Sunday, "this weekend" = today + tomorrow; if weekday, weekend = upcoming Sat-Sun
- **Weeks**: "this week", "next week"
- **Upcoming**: "upcoming", "coming soon", "soon" (next 30 days)
- **Specific dates**: "October 19", "Oct 19", "19 October", "10/19/2026"

All resolved in **Asia/Manila timezone**.

### Special Query Handling

- **"What can I still register for?" / "Registration deadline"**: Filters events where `deadline >= today` AND `status IN ('scheduled', 'confirmed')`
- **"Upcoming events"**: Filters events where `start_datetime >= today` AND `status IN ('scheduled', 'confirmed')`

### Supersession Handling

When an official post is updated (e.g., venue change), the new source is marked with `status: 'updated'` and `supersedes_source_id` pointing to the old source. The old source gets `status: 'superseded'`.

The retrieval engine prefers non-superseded, current-authoritative sources and clearly notes when info was updated.

---

## 🗄️ Database Schema

See [`supabase/migrations/002_fix_embedding_dimension_and_status_model.sql`](supabase/migrations/002_fix_embedding_dimension_and_status_model.sql) (replaces 001).

### Tables

| Table          | Purpose                                              |
| -------------- | ---------------------------------------------------- |
| `sources`      | Ingested source documents (FB posts, websites, PDFs) |
| `source_chunks`| Chunked content with pgvector embeddings (768 dims)  |
| `events`       | Structured festival events with year metadata        |
| `event_sources`| Many-to-many junction with relevance scoring         |

### Key Indexes

- `sources(festival_year, is_current, status)` — fast year-filtered retrieval
- `events(festival_year, start_datetime)` — schedule queries
- `source_chunks(embedding)` — IVFFlat vector index for semantic search

### Idempotency

Sources use `UNIQUE(platform, post_id)` to prevent duplicates on re-ingestion.

### Canonical Source Status Model

**One status enum replaces the previous `status` + `is_current` duplication.**

| Status       | Meaning                                                            | is_current (derived) | Use Case |
| ------------ | ------------------------------------------------------------------ | -------------------- | -------- |
| `active`     | Current, authoritative announcement for its festival year          | `true`               | Normal current info |
| `updated`    | Supersedes a previous source; the new authoritative version        | `true`               | Correction/update with lineage |
| `superseded` | Replaced by a newer `updated` source; preserved for history        | `false`              | Old Facebook post corrected |
| `cancelled`  | Information explicitly cancelled (event cancelled, announcement withdrawn) | `false`        | Cancelled event notice |
| `postponed`  | Information about a postponement; the new date may be in another source | `true`           | "Event moved to Oct 20" post |
| `archived`   | Historical record from past festival years; not current            | `false`              | 2025 sources when querying 2026 |

**Constraints:**
- `status` NOT NULL DEFAULT `'active'`
- `supersedes_source_id` UUID REFERENCES sources(id) — only valid when status = `'updated'`
- `is_current` GENERATED ALWAYS AS (status IN ('active', 'updated', 'postponed')) STORED — **computed column, not user-settable**

### Events Table Status Alignment

`EventStatus` remains unchanged. For ordinary event rows, application helpers derive currentness from status:
- `scheduled`, `confirmed` → current
- `cancelled`, `postponed`, `completed` → not current
- Since Phase 6 migrations 007–008, `events.is_current` is independently writable and synchronized from canonical status; extractor-derived rows additionally stay non-current when their fingerprint is no longer the source's active fingerprint. This permits old audit rows without stale retrieval state.

### Source vs Event Postponement Semantics

> ⚠️ **Critical for the n8n ingestion workflow**: the status `'postponed'` is
> deliberately **asymmetric** between `sources` and `events`. Do not "normalize"
> or "fix" this — it is correct.

| Where                                | `status = 'postponed'` means | `is_current` |
| ------------------------------------ | ---------------------------- | ------------ |
| `sources.status = 'postponed'`       | The **source itself** is a current, authoritative piece of evidence describing the postponement (e.g., a fresh Facebook post "Event moved to Oct 20"). | `true`       |
| `events.status = 'postponed'`        | The **event** is no longer actively scheduled at its original date/time. It is history; a separate (new) event row with `status = 'scheduled'` or `'confirmed'` and the new date represents the now-scheduled event. | `false`      |

**Why the asymmetry:** source currentness answers *"Is this announcement still
authoritative right now?"* — yes, a fresh postponement post is. Event
currentness answers *"Is this event still going to happen as listed?"* — no,
because it has been moved.

**Code references (must stay in sync):**
- `isSourceCurrent()` in [`src/types/index.ts`](src/types/index.ts) returns `true` for `'postponed'`.
- `isEventCurrent()` in [`src/types/index.ts`](src/types/index.ts) returns `false` for `'postponed'`.
- `CURRENT_SOURCE_STATUSES` in [`src/utils/retrieval.ts`](src/utils/retrieval.ts) includes `'postponed'`.
- `CURRENT_EVENT_STATUSES` in [`src/utils/retrieval.ts`](src/utils/retrieval.ts) is `['scheduled', 'confirmed']` (no `'postponed'`).
- `search_source_chunks()` RPC includes `'postponed'` in its filter.
- `get_festival_events()` RPC filters to `'scheduled', 'confirmed'` only.

**For n8n ingestion:**
- When a Facebook post announces a postponement, create/update a `sources` row with `status = 'postponed'` (it IS current evidence).
- When the same post implies an event was moved, set the *old* `events` row's `status = 'postponed'` AND create a *new* `events` row with `status = 'scheduled'` or `'confirmed'` and the new `start_datetime` / `end_datetime`. Do NOT just edit the existing event's date — the postponed row is the audit trail.
- Never mark a `sources` row as `archived` while it's still the freshest announcement about a postponement; that would hide authoritative current evidence from retrieval.

### Row Level Security

- ✅ Public read access on `sources`, `events`, `event_sources` (needed for chat)
- ❌ **NO public read on `source_chunks`** (embeddings are implementation detail, not user-facing)
- ✅ Service role full access on all tables (for ingestion pipeline)
- ✅ Explicit deny policies for anon write access

---

## 🔍 pgvector RPC Functions for Hybrid Retrieval

Three RPC functions provide server-side retrieval logic:

### 1. `search_source_chunks` — Semantic Search

```sql
search_source_chunks(
  query_embedding VECTOR(768),
  target_festival_year INT,
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
)
```

Returns chunks with source metadata, filtered to **current-authoritative sources only** (`status IN ('active', 'updated', 'postponed')`).

### 2. `get_festival_events` — Structured Event Queries

```sql
get_festival_events(
  target_festival_year INT,
  start_date TIMESTAMPTZ DEFAULT NULL,
  end_date TIMESTAMPTZ DEFAULT NULL,
  category_filter TEXT[] DEFAULT NULL,
  status_filter TEXT[] DEFAULT NULL
)
```

Returns events for a festival year with optional date/category/status filtering. Only returns current events (`status IN ('scheduled', 'confirmed')`).

### 3. `get_supersession_chain` — Lineage Resolution

```sql
get_supersession_chain(source_id UUID)
```

Recursive CTE that walks the supersession chain backwards (from updated → superseded → superseded...). Returns full chain with `level` depth.

---

## 🤖 Embedding Model: Gemini `gemini-embedding-001` @ 768 Dimensions

**Decision documented here and in migration comments.**

| Model | Dimensions | Status | Notes |
|-------|------------|--------|-------|
| `gemini-embedding-001` | 768 (configurable) | **Stable, production** | Chosen — sufficient for small KB, lower storage/compute |
| `gemini-embedding-exp-03-07` | 3072 (configurable) | Experimental | Higher quality but overkill for this use case |

**Configuration:** `outputDimensionality: 768` passed to Gemini Embedding API.

**Rationale:**
- Small knowledge base (~hundreds of sources, ~thousands of chunks)
- 768 dimensions provides excellent retrieval quality for this scale
- 4x less storage vs 3072-dim model
- Stable model (not experimental) — no breaking changes risk
- Configurable dimensionality means we can upgrade later if needed

---

## 🧠 Phase 4: Hybrid Retrieval Architecture

The Edge Function's `retrieveEvidence()` implements a query-relevant, year-aware, supersession-safe hybrid retrieval pipeline.

### Flow

```
User Query
   │
   ▼
1. Resolve festival year           → resolveFestivalYear()        (Phase 3)
   │
   ▼
2. Resolve temporal expressions    → resolveTemporalExpression()  (Phase 3)
   │
   ▼
3. Generate query embedding        → generateQueryEmbedding()
   │  (Gemini gemini-embedding-001, 768 dims, taskType=RETRIEVAL_QUERY)
   │
   ▼
4. ┌──────────────────────────┐  ┌───────────────────────────┐
   │ search_source_chunks RPC │  │ get_festival_events RPC   │
   │ (vector similarity)      │  │ (structured filter)       │
   └─────────────┬────────────┘  └──────────┬────────────────┘
                 │                          │
                 ▼                          ▼
8. Filter low-similarity chunks, dedupe by source_id
   │
   ▼
9. Optionally walk supersession chain (only for correction queries)
   │
   ▼
10. Cap: ≤8 sources, ≤15 chunks, ≤10 events
   │
   ▼
11. Format as evidence packet, send to Gemini
```

### Key Properties

| Property | How it's enforced |
| -------- | ----------------- |
| **Year restriction** | RPC `search_source_chunks` and `get_festival_events` both filter by `festival_year` server-side. The Edge Function passes the resolved year as `target_festival_year`. |
| **Superseded exclusion** | RPC `search_source_chunks` filters `status IN ('active', 'updated', 'postponed')`. `superseded`, `cancelled`, and `archived` sources never reach the prompt as primary evidence. |
| **No silent historical fallback** | If the resolved year is the default and the RPC returns few results, we return what we have honestly. Historical years are only retrieved when the user explicitly asks (e.g., "2024 schedule"). |
| **Source deduplication** | Multiple chunks may reference the same source. We keep the highest-similarity chunk per `source_id` and expose a single `Source` record. |
| **Defense-in-depth similarity filter** | Even though the RPC applies `match_threshold`, the Edge Function also drops chunks with `similarity < 0.7` to keep low-signal results out of the prompt. |
| **Context-size caps** | Hard caps: `maxSources=8`, `maxChunks=15`, `maxEvents=10`. Prevents prompt bloat and protects the model's context window. |
| **Optional supersession chain** | Triggered only for explicit correction queries (e.g., "was this changed?", "what was updated?"). Uses `get_supersession_chain` RPC. The chain is included as a separate labeled section, not as primary evidence. |

### Embedding Generation

```typescript
// supabase/functions/chat/index.ts
async function generateQueryEmbedding(query: string): Promise<number[]>
```

- **Model**: `gemini-embedding-001` (configurable via `GEMINI_EMBEDDING_MODEL`)
- **Dimensionality**: 768 (configurable; matches DB schema)
- **Task type**: `RETRIEVAL_QUERY` (better signal than `RETRIEVAL_DOCUMENT` for asymmetric search)
- **Provider**: Modular — the function is the only seam. Swap to OpenAI/Cohere/Vertex by replacing the implementation; downstream code only depends on the `number[]` return type.

If embedding generation fails, the Edge Function still returns event results (degraded mode) but logs the error and tags the response with `queryEmbeddingUsed=false`.

### Prompt Construction

The final prompt to Gemini has these labeled sections (in order):

1. **System prompt** — identity, principles, language rules
2. **Current date & resolved year** — `Asia/Manila` time, year, retrieval stats
3. **Temporal filter annotation** — if a date expression was detected
4. **Available sources** — deduped, status-tagged, capped at 8
5. **Semantic chunks** — top 15 by similarity, with similarity scores
6. **Festival events** — temporal-filtered, capped at 10
7. **Supersession lineage** — only included for correction queries
8. **Conversation history** — last 6 messages
9. **User query**
10. **Instructions** — citation format, language, no-hallucination rules

### What "Honest Retrieval" Means

We **never** pad the prompt with low-similarity chunks or unrelated sources to make the answer look confident. If `search_source_chunks` returns nothing, the prompt says "No sources matched the query for the resolved festival year." If a chunk has `status='superseded'`, we either exclude it (default) or include it in a labeled lineage section (correction queries) — never as primary evidence.

### Test Coverage

[`supabase/functions/chat/retrieval.test.ts`](supabase/functions/chat/retrieval.test.ts) covers:

- Semantic search returns relevant chunks
- Year filtering (2026 query → no 2025 sources as current evidence)
- Superseded exclusion
- Temporal event filtering
- Empty result handling
- Supersession chain resolution
- Embedding failure fallback
- Source deduplication
- Context caps enforced
- No silent historical fallback
- `includeHistorical` opt-in for explicit historical queries
- Correction query triggers chain expansion
- Low-similarity chunk rejection
- Category and status filter passing

Run with:

```bash
deno test --allow-net --allow-env supabase/functions/chat/retrieval.test.ts
```

---

## 🛠️ Supabase Edge Function

The chat endpoint is implemented in [`supabase/functions/chat/index.ts`](supabase/functions/chat/index.ts).

### Deploy

```bash
# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Deploy the public chat function (publishable API keys are not JWTs)
supabase functions deploy chat --no-verify-jwt

# Set secrets
supabase secrets set GEMINI_API_KEY=your_key_here
# Supabase automatically provides SUPABASE_URL and SUPABASE_SECRET_KEYS.
# Both Edge Functions read the default entry in SUPABASE_SECRET_KEYS.
# Do not upload the local SUPABASE_SECRET_KEY to hosted Edge Functions.
```

The browser sends `SUPABASE_PUBLISHABLE_KEY` in the `apikey` header, not as a bearer JWT. Vite explicitly exposes only this public key; never prefix a secret key with `VITE_` or expose the full server environment. Trusted scripts and n8n send `SUPABASE_SECRET_KEY` in `apikey`. Database roles and permissions are unchanged.

### Request Format

```typescript
POST /functions/v1/chat
Content-Type: application/json

{
  "message": "What's the schedule for 2026?",
  "festivalYear": 2026,
  "language": "en",
  "conversationHistory": [...]
}
```

### Response Format

```typescript
{
  "message": {
    "id": "uuid",
    "role": "assistant",
    "content": "Here's the schedule...",
    "sources": [...],
    "festivalYear": 2026
  },
  "retrievedSources": [...],
  "retrievedEvents": [...],
  "retrievedChunks": [...],
  "yearResolved": 2026,
  "language": "en"
}
```

---

## 🌐 Multilingual Support

The system prompt and demo data support three languages:

| Language          | Code | Example Greeting                          |
| ----------------- | ---- | ----------------------------------------- |
| English           | `en` | "Welcome to Buglasan AI!"                 |
| Cebuano/Bisaya    | `ceb`| "Maayong pag-abot sa Buglasan AI!"        |
| Filipino/Tagalog  | `fil`| "Maligayang pagdating sa Buglasan AI!"    |

To switch language, modify the system prompt or pass `language` in the chat request.

---

## 🔄 Phase 5: Source Collector

The implemented n8n workflow accepts a canonical payload and calls the service-role-only `ingest_source(jsonb)` RPC. Full semantics, idempotency, security, setup, and fixture instructions are in [`docs/source-ingestion.md`](docs/source-ingestion.md).

### Webhook Payload

```json
{
  "platform": "facebook",
  "post_id": "buglasan_2026_xyz",
  "post_url": "https://www.facebook.com/Buglasan/posts/xyz",
  "published_at": "2026-09-01T10:00:00+08:00",
  "post_year": null,
  "festival_year": 2026,
  "raw_text": "Full post text...",
  "normalized_text": "Full post text...",
  "title": null,
  "source_type": "text",
  "media_urls": [],
  "collected_at": "2026-09-01T10:05:00+08:00",
  "collection_method": "manual",
  "source_metadata": {}
}
```

`post_year` is derived from `published_at` when present. `festival_year` is explicit and never inferred.

### Pipeline Steps

1. **Webhook**: Receive an adapter-produced payload.
2. **Normalize**: Safely normalize identity/timestamps and derive `post_year`.
3. **Validate**: Preserve explicit nulls, media arrays, metadata, and raw text.
4. **RPC**: Atomically insert/update only `sources`.
5. **Respond**: Return `inserted`, `updated`, or `unchanged`.

Source collection and knowledge extraction are separate. This workflow does not interpret events or create chunks, embeddings, OCR output, or event records.

### n8n Setup (when ready)

```bash
# Import workflow template
n8n import:workflow --input=./n8n/workflows/buglasan-source-collector.json

# Configure credentials in n8n UI
# Server environment: SUPABASE_URL and SUPABASE_SECRET_KEY
```

---

## 🧪 Testing the Demo

The app ships with a comprehensive synthetic dataset for testing year-awareness and supersession:

### Try These Queries

1. **Schedule for current year** → "What's the schedule for 2026?"
2. **Historical year** → "What about 2024?"
3. **Venue update detection** → "Where is the Showdown held?" (notice the supersession note)
4. **Registration** → "How do I join the street dancing?"
5. **Food fair** → "What local delicacies are featured?"
6. **History** → "What does Buglasan mean?"

### Year Selector

Use the **year dropdown** at the top to switch between current, previous, and historical festival years and see how the AI handles each context.

---

## 🎨 Design System

### Color Palette

| Token              | Hex       | Usage                          |
| ------------------ | --------- | ------------------------------ |
| `fiesta-red`       | `#E53E3E` | Primary CTAs, brand identity   |
| `fiesta-orange`    | `#DD6B20` | Accents, gradients             |
| `fiesta-yellow`    | `#D69E2E` | Highlights, badges             |
| `fiesta-green`     | `#38A169` | Success, "current" tags        |
| `fiesta-blue`      | `#3182CE` | Information, links             |
| `neutral-50`       | `#FAFAFA` | Page background                |
| `neutral-900`      | `#171717` | Body text                      |

### Typography

- **Display**: Poppins (headings, brand)
- **Body**: Inter (chat, UI)

### Mobile-First

- Min touch target: 44×44px
- Breakpoints: sm (640), md (768), lg (1024)
- Sticky header, sticky footer disclaimer
- Safe-area insets for notched devices

---

## 📦 Project Structure

```
buglasan-ai/
├── public/                    # Static assets
│   ├── icons/                 # PWA icons
│   └── manifest.webmanifest   # PWA manifest
├── src/
│   ├── components/            # React UI components
│   │   ├── ChatInterface.tsx
│   │   ├── MessageBubble.tsx
│   │   ├── SourcesCard.tsx
│   │   ├── TypingIndicator.tsx
│   │   ├── FacebookBadge.tsx
│   │   └── AIDisclaimer.tsx
│   ├── data/                  # Demo dataset
│   │   └── demoData.ts
│   ├── services/              # Service adapters
│   │   └── chatService.ts
│   ├── types/                 # TypeScript types
│   │   └── index.ts
│   ├── utils/                 # Helper functions
│   │   └── dateUtils.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css              # Tailwind theme
├── supabase/
│   ├── functions/
│   │   └── chat/              # Edge function
│   │       ├── index.ts
│   │       └── retrieval.test.ts
│   └── migrations/            # SQL migrations
│       └── 002_fix_embedding_dimension_and_status_model.sql
├── .env.example               # Environment template
├── .gitignore
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## 🤝 Contributing

Contributions are welcome. Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- TypeScript strict mode
- Functional React components with hooks
- Tailwind utility classes (no inline styles)
- Comments for non-obvious logic
- No API keys in source code

---

## 📜 License

This project is open source under the [MIT License](LICENSE).

---

## 🙏 Acknowledgments

- **Buglasan Festival organizers** for the cultural celebration
- **Provincial Government of Negros Oriental** for information access
- **Google Gemini** for AI capabilities
- **Supabase** for backend infrastructure
- The **Negros Oriental** community

---

## 📞 Contact

- **Official Source**: [facebook.com/Buglasan](https://www.facebook.com/Buglasan)
- **Project Issues**: [GitHub Issues](../../issues)
- **Author**: Buglasan AI Contributors

---

## 📋 Migration Strategy Note

Since the project has **not entered production**, migration `002_fix_embedding_dimension_and_status_model.sql` is a **clean replacement** (drops and recreates all tables) rather than an incremental ALTER TABLE migration. This avoids technical debt and ensures a clean schema from the start.

When the project reaches production, future migrations will be incremental (ALTER TABLE, CREATE INDEX CONCURRENTLY, etc.).

---

## 🔍 Audit & Hardening Summary (Phase 7)

11-problem audit cycle closed. Final state:

- **Schema** — embedding dim aligned to 768 (Gemini `gemini-embedding-001`); canonical 6-value source `status` enum (`active`/`updated`/`superseded`/`cancelled`/`postponed`/`archived`). `sources.is_current` remains generated; Phase 6 migrations 007–008 make `events.is_current` writable for extraction audit history while synchronizing it from event status and active source fingerprint.
- **Retrieval** — `search_source_chunks` + `get_festival_events` + `get_supersession_chain` RPCs; hybrid pipeline (year → temporal → embed → vector + structured join → cap). No silent historical fallback; historical years are explicit-opt-in only.
- **Year resolution** — defaults to current calendar year in `Asia/Manila`; no October advance.
- **Demo data** — every demo source prefixed `[DEMO FIXTURE]` and marked synthetic; all response claims derive from fixture sources (no hard-coded strings).
- **RPC security** — `source_chunks` no longer publicly readable (embeddings are implementation detail); explicit deny on anon writes; service-role only for ingestion.
- **Tests** — 117 Vitest client tests + 20 Deno edge-function tests covering year isolation, supersession safety, temporal filtering, source dedup, cap enforcement, zero-evidence behavior, and embedding-failure fallback.
- **n8n ingestion** — contract documented; **not yet implemented**. Blockers listed below.

### Blockers Before n8n Can Start

1. Apply migration `002_fix_embedding_dimension_and_status_model.sql` to the target Supabase project.
2. Set the Supabase Edge Function secret `GEMINI_API_KEY`; hosted `SUPABASE_URL` and `SUPABASE_SECRET_KEYS` are automatically provided.
3. Configure OAuth / credentials inside n8n: Facebook Graph API (page access token), Google Gemini Embeddings, Supabase secret-key connection.
4. Confirm target Facebook page ID + webhook URL allowlist for the ingestion trigger.

---

<p align="center">
  <strong>🎭 Viva Buglasan! 🎭</strong><br>
  <em>Celebrating Negros Oriental's cultural heritage through AI</em>
</p>
