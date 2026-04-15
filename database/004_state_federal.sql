-- MarylandIQ — Migration 004: State & Federal Offices
-- Run in Supabase SQL Editor after schema.sql and seed_jurisdictions.sql.
--
-- Adds:
--   1. 'statewide' type to the jurisdictions CHECK constraint
--   2. A single maryland-statewide jurisdiction used by all non-county races
--   3. State and federal office records

-- ── 1. Widen the jurisdictions type constraint ────────────────────────────────
-- Drop the existing check and replace with an expanded one.
ALTER TABLE jurisdictions
    DROP CONSTRAINT IF EXISTS jurisdictions_type_check;

ALTER TABLE jurisdictions
    ADD CONSTRAINT jurisdictions_type_check
    CHECK (type IN ('county', 'city', 'statewide'));

-- ── 2. Maryland statewide jurisdiction ───────────────────────────────────────
-- All Governor, AG, Comptroller, U.S. Senate, State Senate, House of Delegates,
-- and U.S. House contests use this as their jurisdiction.
-- The district_name column on contests carries the legislative/congressional
-- district identifier (e.g. "Legislative District 5", "Congressional District 3").
INSERT INTO jurisdictions (slug, name, type, county_board_url)
VALUES (
    'maryland-statewide',
    'Maryland',
    'statewide',
    'https://elections.maryland.gov'
)
ON CONFLICT (slug) DO NOTHING;

-- ── 3. State and federal offices ─────────────────────────────────────────────
INSERT INTO offices (slug, name) VALUES
    ('governor',                'Governor'),
    ('attorney-general',        'Attorney General'),
    ('us-senator',              'U.S. Senator'),
    ('us-representative',       'U.S. Representative'),
    ('state-senator',           'State Senator'),
    ('house-of-delegates-member', 'House of Delegates Member')
ON CONFLICT (slug) DO NOTHING;

-- Note: 'comptroller' slug may already exist from county-level seeding.
-- The statewide Comptroller uses the same office record — both point to the
-- same office concept; the jurisdiction differentiates them in contests.
INSERT INTO offices (slug, name) VALUES
    ('comptroller', 'Comptroller')
ON CONFLICT (slug) DO NOTHING;
