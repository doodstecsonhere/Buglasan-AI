-- Buglasan AI - Schema Fixes: Embedding Dimension & Canonical Status Model
-- Migration: 002_fix_embedding_dimension_and_status_model.sql
-- Description: Clean replacement migration (pre-production) fixing embedding dimension to 768
--              for Gemini gemini-embedding-001, implementing canonical status model,
--              adding pgvector RPC functions, and hardening RLS.
--
-- EMBEDDING MODEL DECISION:
-- Using Google Gemini `gemini-embedding-001` with `outputDimensionality: 768`
-- - Stable, production-ready model (not experimental)
-- - 768 dimensions sufficient for small knowledge base
-- - Lower storage/compute vs 3072-dim experimental model
-- - Configurable output dimensionality via API parameter
--
-- IMPORTANT — NORMALIZATION:
-- gemini-embedding-001 returns UNNORMALIZED vectors. Per Google's current
-- documentation, when the output is truncated (e.g. to 768 dims) for cosine
-- similarity use, the caller MUST apply L2 normalization (unit vector)
-- BEFORE storage / before passing into this RPC. Otherwise pgvector's
-- `<=>` cosine distance will not match expected cosine similarity semantics.
-- Document embeddings (n8n ingestion) AND query embeddings (Edge Function)
-- must both be normalized to unit length.
--
-- =============================================================================
-- SOURCE vs EVENT POSTPONEMENT SEMANTICS (IMPORTANT — DO NOT CONFUSE)
-- =============================================================================
-- The schema deliberately treats "postponed" asymmetrically between sources
-- and events. This mirrors the application semantics in src/types/index.ts and
-- src/utils/retrieval.ts and MUST be preserved by any future migration or
-- n8n ingestion workflow.
--
--   sources.status = 'postponed'  →  sources.is_current = TRUE
--       The source itself is a CURRENT, authoritative piece of evidence about
--       a postponement. It is fresh, valid, and must be returned by retrieval
--       pipelines (it tells the user "the event moved to Oct 20").
--       Evidence: isSourceCurrent() in src/types/index.ts returns true for
--       'postponed'; CURRENT_SOURCE_STATUSES in src/utils/retrieval.ts
--       includes 'postponed'; search_source_chunks() RPC filters
--       status IN ('active', 'updated', 'postponed').
--
--   events.status  = 'postponed'  →  events.is_current = FALSE
--       The event is NO LONGER actively scheduled. It must be excluded from
--       "upcoming events" lists and from primary retrieval. A fresh event
--       row (status = 'scheduled' or 'confirmed') with the new date is what
--       represents the now-scheduled event — the postponed row is history.
--       Evidence: isEventCurrent() in src/types/index.ts returns false for
--       'postponed'; CURRENT_EVENT_STATUSES in src/utils/retrieval.ts is
--       ['scheduled', 'confirmed']; get_festival_events() RPC filters
--       status IN ('scheduled', 'confirmed').
--
-- Why the asymmetry: source currentness describes "is this announcement
-- still authoritative right now?"; event currentness describes "is this
-- event still going to happen as listed?". A fresh postponement post is
-- authoritative; the old scheduled event is not.
--
-- =============================================================================
-- RLS MODEL (SIMPLEST SECURE DEFAULT)
-- =============================================================================
-- - sources, events, event_sources: SELECT allowed for anon + authenticated.
-- - source_chunks: NO anon/authenticated SELECT (embeddings are internal).
--   service_role bypasses RLS by default in Supabase, so ingestion writes work
--   without an explicit policy. No public read policy is created for it.
-- - anon / authenticated: NO INSERT/UPDATE/DELETE policies on ingestion tables.
--   Under RLS, absence of an applicable policy = denied. We do NOT add
--   redundant fake "deny" policies.
-- - service_role: explicit FOR ALL policies are kept because they are
--   syntactically valid (single command) and provide clear defense-in-depth
--   documentation, even though service_role bypasses RLS by default.
--
-- IMPORTANT: PostgreSQL CREATE POLICY allows ONLY ONE command per policy
-- (ALL, SELECT, INSERT, UPDATE, or DELETE). A comma-separated command list
-- such as `FOR INSERT, UPDATE, DELETE` is INVALID syntax and will fail at
-- apply time. Every policy below uses a single command.

-- ============================================
-- DROP EXISTING OBJECTS (CLEAN SLATE - PRE-PRODUCTION)
-- ============================================

-- Drop RLS policies first (must drop before tables)
DROP POLICY IF EXISTS "Public read access for sources" ON sources;
DROP POLICY IF EXISTS "Public read access for source_chunks" ON source_chunks;
DROP POLICY IF EXISTS "Public read access for events" ON events;
DROP POLICY IF EXISTS "Public read access for event_sources" ON event_sources;
DROP POLICY IF EXISTS "Service role full access for sources" ON sources;
DROP POLICY IF EXISTS "Service role full access for source_chunks" ON source_chunks;
DROP POLICY IF EXISTS "Service role full access for events" ON events;
DROP POLICY IF EXISTS "Service role full access for event_sources" ON event_sources;

-- Drop triggers
DROP TRIGGER IF EXISTS update_sources_updated_at ON sources;
DROP TRIGGER IF EXISTS update_events_updated_at ON events;

-- Drop functions
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP FUNCTION IF EXISTS search_source_chunks(extensions.vector(768), INT, FLOAT, INT);
DROP FUNCTION IF EXISTS get_festival_events(INT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], TEXT[]);
DROP FUNCTION IF EXISTS get_supersession_chain(UUID);

-- Drop tables (CASCADE handles foreign keys)
DROP TABLE IF EXISTS event_sources CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS source_chunks CASCADE;
DROP TABLE IF EXISTS sources CASCADE;

-- ============================================
-- ENABLE REQUIRED EXTENSIONS
-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;  -- pgvector for embeddings

-- ============================================
-- SOURCES TABLE
-- Canonical status model with computed is_current column.
-- REMINDER: sources.status = 'postponed' means the source IS CURRENT
-- evidence of a postponement (is_current = true). Do not change this.
-- ============================================
CREATE TABLE sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'website', 'pdf', 'news', 'official')),
    post_id TEXT NOT NULL,
    post_url TEXT NOT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    festival_year INTEGER NOT NULL,
    raw_text TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    -- Canonical status enum (replaces status + is_current duplication)
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
        'active',      -- Current, authoritative announcement for its festival year
        'updated',     -- Supersedes a previous source; the new authoritative version
        'superseded',  -- Replaced by a newer 'updated' source; preserved for history
        'cancelled',   -- Information explicitly cancelled (event cancelled, announcement withdrawn)
        'postponed',   -- CURRENT evidence of a postponement; is_current = true
        'archived'     -- Historical record from past festival years; not current
    )),
    supersedes_source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
    -- Computed column: true for active/updated/postponed, false for superseded/cancelled/archived
    is_current BOOLEAN GENERATED ALWAYS AS (
        status IN ('active', 'updated', 'postponed')
    ) STORED,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Idempotent unique constraint: one source per platform+post_id combination
    CONSTRAINT unique_platform_post_id UNIQUE (platform, post_id),
    -- Constraint: supersedes_source_id only valid when status = 'updated'
    CONSTRAINT supersedes_only_for_updated CHECK (
        supersedes_source_id IS NULL OR status = 'updated'
    )
);

-- Indexes for sources
CREATE INDEX idx_sources_festival_year ON sources(festival_year);
CREATE INDEX idx_sources_published_at ON sources(published_at DESC);
CREATE INDEX idx_sources_status ON sources(status);
CREATE INDEX idx_sources_is_current ON sources(is_current) WHERE is_current = TRUE;
CREATE INDEX idx_sources_platform ON sources(platform);
CREATE INDEX idx_sources_supersedes ON sources(supersedes_source_id) WHERE supersedes_source_id IS NOT NULL;
-- Composite index for common query pattern: year + current + status
CREATE INDEX idx_sources_year_current_status ON sources(festival_year, is_current, status);

-- ============================================
-- SOURCE_CHUNKS TABLE
-- Embedding dimension: 768 (Gemini gemini-embedding-001)
-- REMINDER: NO public read policy on this table — embeddings are an
-- internal implementation detail. service_role bypasses RLS by default.
-- Vectors MUST be L2-normalized (unit length) at write time — see header
-- block on gemini-embedding-001 normalization for cosine similarity.
-- ============================================
CREATE TABLE source_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding extensions.vector(768),  -- pgvector embedding (768 dims, L2-normalized, for Gemini gemini-embedding-001)
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT unique_source_chunk UNIQUE (source_id, chunk_index)
);

-- Indexes for source_chunks
CREATE INDEX idx_source_chunks_source_id ON source_chunks(source_id);
-- IVFFlat index for cosine similarity search (lists tuned for expected data size)
CREATE INDEX idx_source_chunks_embedding ON source_chunks USING ivfflat (embedding extensions.vector_cosine_ops) WITH (lists = 100);

-- ============================================
-- EVENTS TABLE
-- Status aligned with canonical model, is_current as GENERATED column.
-- REMINDER: events.status = 'postponed' means the event is NOT currently
-- scheduled (is_current = false). Excluded from "upcoming events" lists.
-- ============================================
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_name TEXT NOT NULL,
    aliases TEXT[] NOT NULL DEFAULT '{}',
    description TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
        'ceremony', 'competition', 'exhibit', 'food', 'trade', 
        'cultural', 'sports', 'workshop', 'concert', 'parade', 'other'
    )),
    start_datetime TIMESTAMPTZ NOT NULL,
    end_datetime TIMESTAMPTZ NOT NULL,
    venue TEXT NOT NULL,
    organizer TEXT NOT NULL,
    deadline TIMESTAMPTZ,
    eligibility TEXT,
    fees TEXT,
    contact_info TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
        'scheduled', 'confirmed', 'cancelled', 'postponed', 'completed'
    )),
    -- Computed column: true for scheduled/confirmed, false for cancelled/postponed/completed
    is_current BOOLEAN GENERATED ALWAYS AS (
        status IN ('scheduled', 'confirmed')
    ) STORED,
    festival_year INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for events
CREATE INDEX idx_events_festival_year ON events(festival_year);
CREATE INDEX idx_events_start_datetime ON events(start_datetime);
CREATE INDEX idx_events_end_datetime ON events(end_datetime);
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_is_current ON events(is_current) WHERE is_current = TRUE;
CREATE INDEX idx_events_category ON events(category);
CREATE INDEX idx_events_venue ON events(venue);
-- Composite index for common query pattern
CREATE INDEX idx_events_year_current ON events(festival_year, is_current);

-- ============================================
-- EVENT_SOURCES TABLE
-- Many-to-many junction between events and sources with relevance scoring
-- ============================================
CREATE TABLE event_sources (
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    relevance_score REAL NOT NULL DEFAULT 1.0 CHECK (relevance_score >= 0 AND relevance_score <= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    PRIMARY KEY (event_id, source_id)
);

-- Indexes for event_sources
CREATE INDEX idx_event_sources_event_id ON event_sources(event_id);
CREATE INDEX idx_event_sources_source_id ON event_sources(source_id);
CREATE INDEX idx_event_sources_relevance ON event_sources(relevance_score DESC);

-- ============================================
-- UPDATED_AT TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_sources_updated_at
    BEFORE UPDATE ON sources
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_events_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- PGVECTOR RPC FUNCTIONS FOR HYBRID RETRIEVAL
-- ============================================

-- 1. Semantic search over source_chunks for a given festival year
-- Returns chunks with source metadata, filtered to current-authoritative sources only.
-- Note: includes status = 'postponed' because a postponed source is CURRENT
-- evidence about the postponement (see header semantics block).
--
-- IMPORTANT: query_embedding MUST be L2-normalized (unit length), and the
-- stored embeddings MUST also be L2-normalized. gemini-embedding-001 returns
-- unnormalized vectors; the caller truncates to 768 dims AND applies L2
-- normalization before calling this RPC or before INSERT into source_chunks.
-- Without normalization, pgvector's `<=>` cosine distance produces values that
-- do not match the model's intended cosine similarity.
CREATE OR REPLACE FUNCTION search_source_chunks(
    query_embedding extensions.vector(768),
    target_festival_year INT,
    match_threshold FLOAT DEFAULT 0.7,
    match_count INT DEFAULT 10
) RETURNS TABLE (
    chunk_id UUID,
    source_id UUID,
    chunk_index INT,
    content TEXT,
    similarity FLOAT,
    source_platform TEXT,
    source_published_at TIMESTAMPTZ,
    source_festival_year INT,
    source_status TEXT,
    source_supersedes_source_id UUID
) LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT
        sc.id AS chunk_id,
        sc.source_id,
        sc.chunk_index,
        sc.content,
        1 - (sc.embedding OPERATOR(extensions.<=>) query_embedding) AS similarity,
        s.platform AS source_platform,
        s.published_at AS source_published_at,
        s.festival_year AS source_festival_year,
        s.status AS source_status,
        s.supersedes_source_id
    FROM source_chunks sc
    JOIN sources s ON sc.source_id = s.id
    WHERE s.festival_year = target_festival_year
        AND s.status IN ('active', 'updated', 'postponed')  -- only current-authoritative
        AND 1 - (sc.embedding OPERATOR(extensions.<=>) query_embedding) > match_threshold
    ORDER BY sc.embedding OPERATOR(extensions.<=>) query_embedding
    LIMIT match_count;
$$;

-- 2. Get structured events for a festival year with optional date/category/status filtering.
-- Note: filters to status IN ('scheduled', 'confirmed') only — postponed/cancelled/completed
-- events are NOT upcoming and must be excluded from "current" event lists
-- (see header semantics block).
CREATE OR REPLACE FUNCTION get_festival_events(
    target_festival_year INT,
    start_date TIMESTAMPTZ DEFAULT NULL,
    end_date TIMESTAMPTZ DEFAULT NULL,
    category_filter TEXT[] DEFAULT NULL,
    status_filter TEXT[] DEFAULT NULL
) RETURNS TABLE (
    id UUID,
    event_name TEXT,
    aliases TEXT[],
    description TEXT,
    category TEXT,
    start_datetime TIMESTAMPTZ,
    end_datetime TIMESTAMPTZ,
    venue TEXT,
    organizer TEXT,
    deadline TIMESTAMPTZ,
    eligibility TEXT,
    fees TEXT,
    contact_info TEXT,
    status TEXT,
    festival_year INT
) LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT
        e.id, e.event_name, e.aliases, e.description, e.category,
        e.start_datetime, e.end_datetime, e.venue, e.organizer,
        e.deadline, e.eligibility, e.fees, e.contact_info,
        e.status, e.festival_year
    FROM events e
    WHERE e.festival_year = target_festival_year
        AND e.status IN ('scheduled', 'confirmed')  -- only current
        AND (start_date IS NULL OR e.end_datetime >= start_date)
        AND (end_date IS NULL OR e.start_datetime <= end_date)
        AND (category_filter IS NULL OR e.category = ANY(category_filter))
        AND (status_filter IS NULL OR e.status = ANY(status_filter))
    ORDER BY e.start_datetime ASC;
$$;

-- 3. Resolve supersession chain for a source (recursive CTE)
-- Returns the full chain from the given source back through superseded sources
CREATE OR REPLACE FUNCTION get_supersession_chain(source_id UUID)
RETURNS TABLE (
    source_id UUID,
    platform TEXT,
    post_id TEXT,
    published_at TIMESTAMPTZ,
    festival_year INT,
    status TEXT,
    supersedes_source_id UUID,
    level INT
) LANGUAGE sql STABLE PARALLEL SAFE AS $$
    WITH RECURSIVE chain AS (
        SELECT s.*, 0 AS level FROM sources s WHERE s.id = source_id
        UNION ALL
        SELECT s.*, c.level + 1
        FROM sources s
        JOIN chain c ON s.id = c.supersedes_source_id
        WHERE c.level < 10  -- safety limit to prevent infinite recursion
    )
    SELECT * FROM chain;
$$;

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Model:
--   - sources / events / event_sources: SELECT for anon + authenticated.
--   - source_chunks: NO anon/authenticated policy (embeddings are internal).
--     service_role bypasses RLS by default — ingestion writes still work.
--   - No INSERT/UPDATE/DELETE policies for anon/authenticated on any table.
--     Under RLS, absence of an applicable policy = denied. We deliberately
--     do NOT add redundant fake "deny" policies.
--   - service_role has explicit FOR ALL policies for documentation /
--     defense-in-depth. Each policy uses a SINGLE command (ALL) which is
--     valid PostgreSQL syntax.
-- ============================================
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_sources ENABLE ROW LEVEL SECURITY;

-- Idempotency: drop new policy names too, so re-running this migration is safe.
DROP POLICY IF EXISTS "Public read access for sources" ON sources;
DROP POLICY IF EXISTS "Public read access for events" ON events;
DROP POLICY IF EXISTS "Public read access for event_sources" ON event_sources;
DROP POLICY IF EXISTS "Service role full access for sources" ON sources;
DROP POLICY IF EXISTS "Service role full access for source_chunks" ON source_chunks;
DROP POLICY IF EXISTS "Service role full access for events" ON events;
DROP POLICY IF EXISTS "Service role full access for event_sources" ON event_sources;

-- Public read policies (anon + authenticated) — ONE policy per role per table
-- so each policy uses a single command (SELECT). Both roles can read sources,
-- events, and event_sources. source_chunks intentionally has NO public read.
CREATE POLICY "Public read access for sources" ON sources
    FOR SELECT TO anon, authenticated USING (TRUE);

-- NO public read policy for source_chunks — embeddings are internal implementation detail.
-- service_role bypasses RLS by default, so ingestion reads via service_role still work.

CREATE POLICY "Public read access for events" ON events
    FOR SELECT TO anon, authenticated USING (TRUE);

CREATE POLICY "Public read access for event_sources" ON event_sources
    FOR SELECT TO anon, authenticated USING (TRUE);

-- Service role full access — explicit FOR ALL policies (single command per policy).
-- service_role bypasses RLS by default in Supabase; these are kept for
-- defense-in-depth and clarity. Each policy uses a single command (ALL).
CREATE POLICY "Service role full access for sources" ON sources
    FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "Service role full access for source_chunks" ON source_chunks
    FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "Service role full access for events" ON events
    FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "Service role full access for event_sources" ON event_sources
    FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- NOTE: No INSERT/UPDATE/DELETE policies for anon or authenticated on any table.
-- Under RLS, absence of an applicable policy = denied. Explicit deny policies
-- would be redundant and would risk introducing the same `FOR cmd1, cmd2`
-- invalid syntax we just fixed.
