-- Migration 002 — Discovery evidence for thin-data candidates
-- Run in Supabase SQL Editor after schema.sql (001).
--
-- Adds structured discovery results to candidate_enrichment:
--   discovery_evidence  JSONB — full evidence record from discover_thin_candidates.py
--   discovery_run_at    TIMESTAMPTZ — when discovery last ran for this candidate
--
-- discovery_evidence shape:
-- {
--   "best_match": {
--     "url": "...", "title": "...", "source_type": "ballotpedia|civic|news|campaign|social|other",
--     "score": 3.5, "confidence": "high|medium|low", "rationale": "...",
--     "emails": [], "phones": [], "committee_mentions": [], "office_phrases": [],
--     "outbound_social_links": [], "llm_extraction": {...}, "fetched_at": "..."
--   },
--   "all_candidates": [...],   -- top 5 scored pages
--   "finance_data": {          -- from Maryland Campaign Finance DB
--     "committee_name": "...", "treasurer_name": "...", "address": "..."
--   },
--   "run_at": "..."
-- }

ALTER TABLE candidate_enrichment
    ADD COLUMN IF NOT EXISTS discovery_evidence  jsonb         DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS discovery_run_at    timestamptz   DEFAULT NULL;

-- GIN index for querying inside the JSONB (e.g. confidence, source_type filters)
CREATE INDEX IF NOT EXISTS enrichment_discovery_evidence_gin
    ON candidate_enrichment USING GIN (discovery_evidence);

-- B-tree index for pipeline queries: "which candidates haven't been run yet?"
CREATE INDEX IF NOT EXISTS enrichment_discovery_run_at_idx
    ON candidate_enrichment (discovery_run_at);

-- Comment for documentation in Supabase table editor
COMMENT ON COLUMN candidate_enrichment.discovery_evidence IS
    'Structured evidence record from discover_thin_candidates.py. '
    'Contains best_match page, all scored candidates, and MD Campaign Finance data. '
    'Confidence: high (>=4.0), medium (2.0-3.9), low (<2.0).';

COMMENT ON COLUMN candidate_enrichment.discovery_run_at IS
    'Timestamp of last discover_thin_candidates.py run for this candidate. '
    'NULL means discovery has not yet been attempted.';
