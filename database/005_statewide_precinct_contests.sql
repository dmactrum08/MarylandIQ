-- MarylandIQ — Migration 005: Wire statewide contests into precinct_contests
-- Run in Supabase SQL Editor after 004_state_federal.sql.
--
-- Governor, Comptroller, and Attorney General appear on every Maryland
-- voter's ballot regardless of precinct. This inserts one precinct_contests
-- row for each precinct × each statewide contest.
--
-- Safe to re-run: uses ON CONFLICT DO NOTHING.

INSERT INTO precinct_contests (precinct_id, contest_id)
SELECT
    p.id   AS precinct_id,
    c.id   AS contest_id
FROM precincts p
CROSS JOIN contests c
WHERE c.jurisdiction_id = (
    SELECT id FROM jurisdictions WHERE slug = 'maryland-statewide'
)
AND c.district_name IS NULL   -- Governor, AG, Comptroller only (not district races)
ON CONFLICT DO NOTHING;

-- Verify
SELECT
    c.slug,
    COUNT(pc.precinct_id) AS precinct_count
FROM contests c
JOIN precinct_contests pc ON pc.contest_id = c.id
WHERE c.jurisdiction_id = (
    SELECT id FROM jurisdictions WHERE slug = 'maryland-statewide'
)
AND c.district_name IS NULL
GROUP BY c.slug
ORDER BY c.slug;
