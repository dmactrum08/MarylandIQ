-- MarylandIQ — Supabase RPC Functions
-- Run this in Supabase SQL Editor AFTER schema.sql.
-- These functions are called by the Python pipeline scripts via supabase.rpc().

-- ============================================================
-- upsert_precinct
-- Called by load_precinct_boundaries.py to insert/update precinct rows.
-- Uses ST_GeomFromGeoJSON to convert GeoJSON geometry → PostGIS.
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_precinct(
    p_precinct_code   text,
    p_jurisdiction_id uuid,
    p_geometry_geojson text,
    p_source_url      text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO precincts (precinct_code, jurisdiction_id, geometry, source_url, loaded_at)
    VALUES (
        p_precinct_code,
        p_jurisdiction_id,
        ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON(p_geometry_geojson)), 4326),
        p_source_url,
        now()
    )
    ON CONFLICT (precinct_code, jurisdiction_id)
    DO UPDATE SET
        geometry   = EXCLUDED.geometry,
        source_url = EXCLUDED.source_url,
        loaded_at  = now();
END;
$$;

-- ============================================================
-- lookup_precinct
-- Called by load_precinct_boundaries.py validation step.
-- Also the canonical form of Step 1 in the ballot lookup query.
-- Accepts lat/lng, returns the matching precinct.
-- ============================================================
CREATE OR REPLACE FUNCTION lookup_precinct(
    p_lat numeric,
    p_lng numeric
)
RETURNS TABLE(
    precinct_id   uuid,
    precinct_code text,
    jurisdiction_id uuid
)
LANGUAGE sql
STABLE
AS $$
    SELECT p.id, p.precinct_code, p.jurisdiction_id
    FROM precincts p
    WHERE ST_Within(
        ST_SetSRID(ST_Point(p_lng, p_lat), 4326),
        p.geometry
    )
    LIMIT 1;
$$;

-- ============================================================
-- lookup_ballot
-- Full two-step ballot lookup — used by the /api/ballot-lookup edge function.
-- Returns all upcoming contests for the precinct containing (lat, lng).
-- ============================================================
CREATE OR REPLACE FUNCTION lookup_ballot(
    p_lat           numeric,
    p_lng           numeric,
    p_election_type text DEFAULT NULL,
    p_voter_party   text DEFAULT NULL
)
RETURNS TABLE(
    contest_slug    text,
    election_type   text,
    election_date   date,
    office_name     text,
    district_name   text,
    candidate_count bigint
)
LANGUAGE sql
STABLE
AS $$
    WITH matched_precinct AS (
        SELECT p.id AS precinct_id
        FROM precincts p
        WHERE ST_Within(
            ST_SetSRID(ST_Point(p_lng, p_lat), 4326),
            p.geometry
        )
        LIMIT 1
    ),
    contest_base AS (
        SELECT
            c.id,
            c.slug,
            c.election_type,
            c.election_date,
            o.name AS office_name,
            c.district_name
        FROM matched_precinct mp
        JOIN precinct_contests pc ON pc.precinct_id = mp.precinct_id
        JOIN contests c           ON c.id = pc.contest_id
        JOIN offices o            ON o.id = c.office_id
        WHERE c.election_date >= CURRENT_DATE
          AND (p_election_type IS NULL OR c.election_type = p_election_type)
    ),
    candidate_stats AS (
        SELECT
            cb.id AS contest_id,
            COUNT(cand.id) AS total_candidate_count,
            COUNT(cand.id) FILTER (
                WHERE NULLIF(TRIM(cand.party), '') IS NOT NULL
                  AND LOWER(TRIM(cand.party)) <> 'nonpartisan'
            ) AS partisan_candidate_count,
            COUNT(cand.id) FILTER (
                WHERE p_voter_party IS NOT NULL
                  AND NULLIF(TRIM(cand.party), '') IS NOT NULL
                  AND LOWER(TRIM(cand.party)) = LOWER(TRIM(p_voter_party))
            ) AS selected_party_candidate_count
        FROM contest_base cb
        LEFT JOIN candidates cand ON cand.contest_id = cb.id
                                 AND cand.filing_status = 'Active'
        GROUP BY cb.id
    )
    SELECT
        cb.slug AS contest_slug,
        cb.election_type,
        cb.election_date,
        cb.office_name,
        cb.district_name,
        CASE
            WHEN cb.election_type = 'primary'
             AND p_voter_party IS NOT NULL
             AND COALESCE(cs.partisan_candidate_count, 0) > 0
            THEN COALESCE(cs.selected_party_candidate_count, 0)
            ELSE COALESCE(cs.total_candidate_count, 0)
        END AS candidate_count
    FROM contest_base cb
    LEFT JOIN candidate_stats cs ON cs.contest_id = cb.id
    WHERE
        cb.election_type <> 'primary'
        OR p_voter_party IS NULL
        OR COALESCE(cs.partisan_candidate_count, 0) = 0
        OR COALESCE(cs.selected_party_candidate_count, 0) > 0
    ORDER BY cb.election_date, cb.office_name;
$$;

-- ============================================================
-- get_precincts_in_district
-- Called by load_district_boundaries.py.
-- Returns all precincts in a jurisdiction that intersect a given
-- district polygon (passed as GeoJSON). Used to build precinct_contests
-- rows for district-level races (county council, commissioners, etc.)
-- ============================================================
CREATE OR REPLACE FUNCTION get_precincts_in_district(
    p_jurisdiction_id  uuid,
    p_district_geojson text
)
RETURNS TABLE(id uuid)
LANGUAGE sql
STABLE
AS $$
    SELECT p.id
    FROM precincts p
    WHERE p.jurisdiction_id = p_jurisdiction_id
      AND ST_Intersects(
          p.geometry,
          ST_GeomFromGeoJSON(p_district_geojson)
      );
$$;

-- The precinct uniqueness constraint now lives in schema.sql, so no
-- follow-up ALTER TABLE is required before running the loader.
