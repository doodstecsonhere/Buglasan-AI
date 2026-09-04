-- Buglasan AI - Initial Database Schema
-- Migration: 001_initial_schema.sql
-- Description: Core tables for sources, chunks, events, and event_sources with year-aware design

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ============================================
-- SOURCES TABLE
-- Stores ingested source documents (Facebook posts, website pages, PDFs, etc.)
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
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'archived', 'draft')),
    supersedes_source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Idempotent unique constraint: one source per platform+post_id combination
    CONSTRAINT unique_platform_post_id UNIQUE (platform, post_id)
);

-- Indexes for sources
CREATE INDEX idx_sources_festival_year ON sources(festival_year);
CREATE INDEX idx_sources_published_at ON sources(published_at DESC);
CREATE INDEX idx_sources_status ON sources(status);
CREATE INDEX idx_sources_is_current ON sources(is_current) WHERE is_current = TRUE;
CREATE INDEX idx_sources_platform ON sources(platform);
CREATE INDEX idx_sources_supersedes ON sources(supersedes_source_id) WHERE supersedes_source_id IS NOT NULL;

-- ============================================
-- SOURCE_CHUNKS TABLE
-- Stores chunked content from sources for vector retrieval
-- ============================================
CREATE TABLE source_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding extensions.vector(768), -- pgvector embedding (768 dims, L2-normalized, for Gemini gemini-embedding-001)
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT unique_source_chunk UNIQUE (source_id, chunk_index)
);

-- Indexes for source_chunks
CREATE INDEX idx_source_chunks_source_id ON source_chunks(source_id);
CREATE INDEX idx_source_chunks_embedding ON source_chunks USING ivfflat (embedding extensions.vector_cosine_ops) WITH (lists = 100);

-- ============================================
-- EVENTS TABLE
-- Structured festival events with year-aware design
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
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
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
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Enable RLS and create policies for public read access
-- ============================================
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_sources ENABLE ROW LEVEL SECURITY;

-- Public read policies (anon key can read)
CREATE POLICY "Public read access for sources" ON sources
    FOR SELECT USING (TRUE);

CREATE POLICY "Public read access for source_chunks" ON source_chunks
    FOR SELECT USING (TRUE);

CREATE POLICY "Public read access for events" ON events
    FOR SELECT USING (TRUE);

CREATE POLICY "Public read access for event_sources" ON event_sources
    FOR SELECT USING (TRUE);

-- Service role can do everything (for ingestion pipeline)
CREATE POLICY "Service role full access for sources" ON sources
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access for source_chunks" ON source_chunks
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access for events" ON events
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access for event_sources" ON event_sources
    FOR ALL USING (auth.role() = 'service_role');
