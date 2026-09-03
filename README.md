# 🎭 Buglasan AI

> A multilingual, year-aware AI companion for the Buglasan Festival of Negros Oriental, Philippines.

[![Built with Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind-4-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
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
┌───────▼────────┐  ┌─────────▼──────────┐
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
| Ingestion    | n8n workflow (planned)                    |

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
| `npm run preview` | Preview production build locally           |
| `npm run lint`    | Run Oxlint                                 |

---

## 🔐 Environment Variables

Copy `.env.example` to `.env.local` and fill in:

| Variable                          | Required | Description                                      |
| --------------------------------- | -------- | ------------------------------------------------ |
| `VITE_SUPABASE_URL`               | Live mode| Your Supabase project URL                        |
| `VITE_SUPABASE_ANON_KEY`          | Live mode| Supabase anon/public key                         |
| `SUPABASE_SERVICE_ROLE_KEY`       | Edge fn  | Service role key (server-side only!)             |
| `GEMINI_API_KEY`                  | Live mode| Google AI Studio API key                         |
| `GEMINI_MODEL`                    | No       | Override default `gemini-1.5-flash`              |
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

### Current Festival Year Logic

```typescript
const now = new Date()  // Asia/Manila timezone
if (now.getMonth() >= 9) {  // October or later
  currentYear = now.getFullYear() + 1  // Next festival
} else {
  currentYear = now.getFullYear()      // This festival
}
```

Festival typically runs **October 15–25**.

### Date Resolution

Handles natural language:
- "today", "tomorrow", "yesterday"
- "this weekend", "next weekend"
- "upcoming", "coming soon"
- "this week", "next week"
- Specific dates: "October 19", "10/19/2026"

All resolved in **Asia/Manila timezone**.

### Supersession Handling

When an official post is updated (e.g., venue change), the new source is marked:

```sql
sources.supersedes_source_id = <old_source_id>
sources.is_current = true
```

The retrieval engine prefers non-superseded, current sources and clearly notes when info was updated.

---

## 🗄️ Database Schema

See [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql).

### Tables

| Table          | Purpose                                              |
| -------------- | ---------------------------------------------------- |
| `sources`      | Ingested source documents (FB posts, websites, PDFs) |
| `source_chunks`| Chunked content with pgvector embeddings             |
| `events`       | Structured festival events with year metadata        |
| `event_sources`| Many-to-many junction with relevance scoring         |

### Key Indexes

- `sources(festival_year, is_current, status)` — fast year-filtered retrieval
- `events(festival_year, start_datetime)` — schedule queries
- `source_chunks(embedding)` — IVFFlat vector index for semantic search

### Idempotency

Sources use `UNIQUE(platform, post_id)` to prevent duplicates on re-ingestion.

### Row Level Security

- ✅ Public read access (anon key)
- ✅ Service role full access (for ingestion pipeline only)

---

## 🛠️ Supabase Edge Function

The chat endpoint is implemented in [`supabase/functions/chat/index.ts`](supabase/functions/chat/index.ts).

### Deploy

```bash
# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Deploy the chat function
supabase functions deploy chat

# Set secrets
supabase secrets set GEMINI_API_KEY=your_key_here
supabase secrets set SUPABASE_URL=your_url_here
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_key_here
```

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

## 🔄 Future: n8n Ingestion Pipeline

A planned n8n workflow will automate source ingestion. Contract:

### Webhook Payload

```json
{
  "platform": "facebook",
  "post_id": "buglasan_2026_xyz",
  "post_url": "https://www.facebook.com/Buglasan/posts/xyz",
  "published_at": "2026-09-01T10:00:00+08:00",
  "raw_text": "Full post text...",
  "festival_year": 2026,
  "is_current": true,
  "status": "active",
  "supersedes_source_id": null
}
```

### Pipeline Steps

1. **Trigger**: Facebook page webhook / scheduled cron / manual
2. **Fetch**: Scrape post content + metadata
3. **Normalize**: Clean text, extract events/venues/dates
4. **Chunk**: Split into ~500 token chunks
5. **Embed**: Generate vectors via OpenAI/Cohere
6. **Upsert**: Idempotent insert into `sources` and `source_chunks`
7. **Link**: Create `event_sources` rows based on extraction
8. **Notify**: Slack/email digest of new content

### n8n Setup (when ready)

```bash
# Import workflow template
n8n import:workflow --input=./n8n/buglasan-ingestion.json

# Configure credentials in n8n UI
# - Facebook Graph API
# - OpenAI / Gemini embeddings
# - Supabase connection
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
- **Body**: Inter (chat, UI text)

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
│   │       └── index.ts
│   └── migrations/            # SQL migrations
│       └── 001_initial_schema.sql
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

Contributions are welcome! Please:

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

<p align="center">
  <strong>🎭 Viva Buglasan! 🎭</strong><br>
  <em>Celebrating Negros Oriental's cultural heritage through AI</em>
</p>