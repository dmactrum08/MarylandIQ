-- MarylandIQ Database Schema
-- Run this in Supabase SQL Editor in order.
-- Prerequisites:
--   CREATE EXTENSION IF NOT EXISTS postgis;
--   CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- JURISDICTIONS
-- The 24 Maryland county jurisdictions (23 counties + Baltimore City)
-- ============================================================
CREATE TABLE IF NOT EXISTS jurisdictions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                text UNIQUE NOT NULL,  -- e.g. 'prince-georges-county'
    name                text NOT NULL,         -- e.g. 'Prince George''s County'
    type                text NOT NULL CHECK (type IN ('county', 'city')),
    sbe_jurisdiction_id text,                  -- MD SBE internal ID
    county_board_url    text                   -- Homepage of county board of elections
);

-- ============================================================
-- OFFICES
-- Office types that appear on 2026 ballots.
-- Decoupled from jurisdictions — same office type appears in multiple counties.
-- ============================================================
CREATE TABLE IF NOT EXISTS offices (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                    text UNIQUE NOT NULL,  -- e.g. 'county-executive'
    name                    text NOT NULL,
    explainer_text          text,                  -- Plain-English description (AI-generated or official)
    explainer_source        text CHECK (explainer_source IN ('official', 'ai_generated')),
    explainer_generated_at  timestamptz
);

-- ============================================================
-- CONTESTS
-- A specific race in a specific jurisdiction/district/election.
-- One contest = one ballot line.
-- ============================================================
CREATE TABLE IF NOT EXISTS contests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            text UNIQUE NOT NULL,      -- e.g. 'pg-county-council-district-4-2026-primary'
    office_id       uuid NOT NULL REFERENCES offices(id),
    jurisdiction_id uuid NOT NULL REFERENCES jurisdictions(id),
    district_name   text,                      -- e.g. 'District 4', null for at-large
    election_date   date NOT NULL,             -- 2026-06-23 (primary) or 2026-11-03 (general)
    election_type   text NOT NULL CHECK (election_type IN ('primary', 'general', 'special')),
    seats_available integer NOT NULL DEFAULT 1,
    sbe_contest_id  text,                      -- MD SBE internal ID for change detection
    last_scraped_at timestamptz
);

-- ============================================================
-- PRECINCTS
-- Maryland voting precincts with PostGIS polygon geometry.
-- Required for ST_Within() ballot lookup query.
-- ============================================================
CREATE TABLE IF NOT EXISTS precincts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    precinct_code   text NOT NULL,
    jurisdiction_id uuid NOT NULL REFERENCES jurisdictions(id),
    geometry        geometry(MultiPolygon, 4326) NOT NULL,  -- WGS84 polygon/multipolygon
    source_url      text,                              -- ArcGIS REST endpoint this polygon came from
    loaded_at       timestamptz DEFAULT now(),
    UNIQUE (precinct_code, jurisdiction_id)
);

-- ============================================================
-- PRECINCT_CONTESTS
-- Junction table: which contests appear on a precinct's ballot.
-- This join powers the ballot lookup.
-- ============================================================
CREATE TABLE IF NOT EXISTS precinct_contests (
    precinct_id uuid NOT NULL REFERENCES precincts(id),
    contest_id  uuid NOT NULL REFERENCES contests(id),
    PRIMARY KEY (precinct_id, contest_id)
);

-- ============================================================
-- CANDIDATES
-- One row per candidate per contest.
-- A candidate in both primary and general gets two rows.
-- ============================================================
CREATE TABLE IF NOT EXISTS candidates (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                    text UNIQUE NOT NULL,  -- e.g. 'jane-smith-pg-council-d4-2026-primary'
    contest_id              uuid NOT NULL REFERENCES contests(id),
    full_name               text NOT NULL,
    party                   text,                  -- 'Democratic' | 'Republican' | 'Green' | etc.
    filing_status           text NOT NULL DEFAULT 'Active'
                                CHECK (filing_status IN ('Active', 'Withdrawn', 'Disqualified')),
    filed_date              date,
    sbe_candidate_id        text NOT NULL,         -- MD SBE internal ID; key for change detection
    campaign_website_url    text,
    facebook_url            text,
    twitter_handle          text,
    linkedin_url            text,
    completeness_score      integer DEFAULT 0 CHECK (completeness_score BETWEEN 0 AND 100),
    last_scraped_at         timestamptz,
    withdrawn_detected_at   timestamptz            -- Set when status flips to Withdrawn
);

-- ============================================================
-- CANDIDATE_ENRICHMENT
-- AI-generated and scraped enrichment. Separate from candidates
-- so the official record is never overwritten by AI output.
-- ============================================================
CREATE TABLE IF NOT EXISTS candidate_enrichment (
    candidate_id            uuid PRIMARY KEY REFERENCES candidates(id),
    scraped_website_text    text,                  -- Raw text from candidate website scrape
    scrape_method           text CHECK (scrape_method IN ('requests', 'playwright')),
    scrape_error            boolean DEFAULT false,
    ai_summary              text,                  -- 2-4 sentence plain-English summary
    ai_summary_sources      jsonb DEFAULT '[]',    -- [{url, label}] — evidence links
    inferred_from_social    boolean DEFAULT false, -- True if summary derived from social only
    social_inference_text   text,                  -- Raw extracted text from social profiles
    issue_tags              text[] DEFAULT '{}',   -- e.g. ['Education', 'Housing']
    issue_tag_sources       jsonb DEFAULT '[]',    -- [{tag, quote_snippet, source_url}]
    enrichment_confidence   text CHECK (enrichment_confidence IN ('high', 'medium', 'low')),
    website_scraped_at      timestamptz,
    social_scraped_at       timestamptz,
    ai_generated_at         timestamptz,
    enrichment_version      integer DEFAULT 0      -- Increment when prompt/logic changes
);

-- ============================================================
-- BALLOT_MEASURES
-- ============================================================
CREATE TABLE IF NOT EXISTS ballot_measures (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                    text UNIQUE NOT NULL,
    jurisdiction_id         uuid NOT NULL REFERENCES jurisdictions(id),
    title                   text NOT NULL,
    official_text           text,
    plain_language_summary  text,                  -- AI-generated, cached
    summary_generated_at    timestamptz,
    source_url              text,
    election_date           date NOT NULL
);

-- ============================================================
-- CORRECTIONS
-- 'Report an issue' form submissions. Reviewed manually for MVP.
-- ============================================================
CREATE TABLE IF NOT EXISTS corrections (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    page_url        text NOT NULL,
    reporter_email  text,
    issue_type      text NOT NULL CHECK (issue_type IN ('wrong_info', 'outdated', 'missing', 'other')),
    description     text NOT NULL,
    status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    created_at      timestamptz DEFAULT now(),
    resolved_at     timestamptz
);

-- ============================================================
-- PIPELINE_RUNS
-- Operational log — one row per script execution.
-- Query this in Supabase table view as your ops dashboard.
-- ============================================================
CREATE TABLE IF NOT EXISTS pipeline_runs (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_at               timestamptz DEFAULT now(),
    script_name          text NOT NULL,
    candidates_processed integer DEFAULT 0,
    new_detected         integer DEFAULT 0,
    withdrawals_detected integer DEFAULT 0,
    errors               integer DEFAULT 0,
    duration_seconds     numeric,
    notes                text
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Spatial index — required for ST_Within() to be fast
CREATE INDEX IF NOT EXISTS precincts_geom_idx
    ON precincts USING GIST(geometry);

-- Change detection during scrape runs
CREATE INDEX IF NOT EXISTS candidates_sbe_id_idx
    ON candidates(sbe_candidate_id);

-- Race page queries
CREATE INDEX IF NOT EXISTS candidates_contest_idx
    ON candidates(contest_id);

-- Thin-candidate pipeline queries
CREATE INDEX IF NOT EXISTS enrichment_completeness_idx
    ON candidates(completeness_score);

-- Ballot lookup filtering
CREATE INDEX IF NOT EXISTS contests_election_idx
    ON contests(election_date, election_type);

-- Precinct boundary lookup by jurisdiction
CREATE INDEX IF NOT EXISTS precincts_jurisdiction_idx
    ON precincts(jurisdiction_id);

-- Precinct-contest join (step 2 of ballot lookup — B-tree is sufficient here)
CREATE INDEX IF NOT EXISTS precinct_contests_precinct_idx
    ON precinct_contests(precinct_id);
