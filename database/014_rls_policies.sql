-- MarylandIQ — Migration 014: Row Level Security policies
-- Run in Supabase SQL Editor.
--
-- Strategy:
--   • Public tables (voter info) — anon + authenticated can SELECT, nothing else
--   • corrections — anon can INSERT (report form), no read/update/delete
--   • pipeline_runs — locked down, no public access
--   • donations — already locked down in 007, no changes needed
--
-- The service_role key (used by pipeline scripts) bypasses RLS entirely,
-- so no pipeline changes are needed.
-- ============================================================


-- ── Public read-only tables ───────────────────────────────────────────────────

ALTER TABLE jurisdictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jurisdictions_public_read" ON jurisdictions
    FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE offices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "offices_public_read" ON offices
    FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE contests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contests_public_read" ON contests
    FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE precincts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "precincts_public_read" ON precincts
    FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE precinct_contests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "precinct_contests_public_read" ON precinct_contests
    FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "candidates_public_read" ON candidates
    FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE candidate_enrichment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "candidate_enrichment_public_read" ON candidate_enrichment
    FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE ballot_measures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ballot_measures_public_read" ON ballot_measures
    FOR SELECT TO anon, authenticated USING (true);


-- ── Corrections: public insert only ──────────────────────────────────────────
-- Anon users can submit reports via the /report form but cannot read, update,
-- or delete any corrections. Only service_role (used by the admin dashboard
-- or manual review) can read/update corrections.

ALTER TABLE corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corrections_public_insert" ON corrections
    FOR INSERT TO anon, authenticated
    WITH CHECK (true);


-- ── Pipeline runs: locked down ────────────────────────────────────────────────
-- No public access. Only service_role reads/writes this table.

ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
-- No policies created — deny-by-default for anon and authenticated roles.
