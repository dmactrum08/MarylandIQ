-- MarylandIQ — Migration 006: Search performance indexes
-- Run in Supabase SQL Editor.

-- Trigram extension for fast ILIKE substring search on candidate names
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS candidates_fullname_trgm_idx
    ON candidates USING GIN (full_name gin_trgm_ops);

-- Party filter
CREATE INDEX IF NOT EXISTS candidates_party_idx
    ON candidates(party);

-- Combined filing_status + full_name for the default listing query
CREATE INDEX IF NOT EXISTS candidates_status_name_idx
    ON candidates(filing_status, full_name);

-- Contest → jurisdiction and office lookups (used by county/office filters)
CREATE INDEX IF NOT EXISTS contests_jurisdiction_idx
    ON contests(jurisdiction_id);

CREATE INDEX IF NOT EXISTS contests_office_idx
    ON contests(office_id);
