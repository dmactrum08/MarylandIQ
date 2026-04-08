# MarylandIQ Build Runbook

This project has completed the core Stage 1 foundation and the first Stage 2 candidate ingest pass.

## Current source decisions

- Precinct boundaries use Maryland iMAP `MD_ElectionBoundaries` layer `2` (`Maryland Precincts 2026`).
- District-level precinct mappings use Maryland SBE precinct-level election results files.
- Maryland iMAP `MD_ElectionBoundaries` was re-checked on April 8, 2026 and does expose an official precinct layer:
  `https://mdgeodata.md.gov/imap/rest/services/Boundaries/MD_ElectionBoundaries/FeatureServer/2`
- Maryland iMAP `MD_PoliticalBoundaries` was checked and does not expose county council or commissioner district layers.

## SQL setup order

Run these in Supabase SQL editor:

1. `CREATE EXTENSION IF NOT EXISTS postgis;`
2. `CREATE EXTENSION IF NOT EXISTS pgcrypto;`
3. [`database/schema.sql`](/Users/dm/PycharmProjects/MarylandIQ/database/schema.sql)
4. [`database/seed_jurisdictions.sql`](/Users/dm/PycharmProjects/MarylandIQ/database/seed_jurisdictions.sql)
5. [`database/functions.sql`](/Users/dm/PycharmProjects/MarylandIQ/database/functions.sql)

## Local setup

1. Copy `.env.example` to `.env`.
2. Fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Install dependencies with `pip install -r requirements.txt`.
4. If you plan to work on Stage 2 scraping, also run `playwright install chromium`.

## Stage 1 execution order

1. `python -m pipeline.ingest_contests`
2. `python -m pipeline.load_precinct_boundaries`
3. `python -m pipeline.load_district_boundaries`

## Proven state

- Supabase schema, functions, and jurisdiction seed are applied.
- Official Maryland 2026 precinct boundaries load from Maryland iMAP.
- District-level precinct mappings load from 2022 Maryland SBE precinct results.
- `lookup_ballot()` returns plausible 2026 primary contests for real Maryland coordinates.
- `lookup_ballot()` now supports an optional voter party parameter for primary filtering.
- `pipeline.ingest_sbe_candidates.py` successfully ingests the live 2026 Maryland SBE local candidate page.
- Candidate party values are now populated (`Democratic`, `Republican`, `Nonpartisan`, `Unaffiliated`).

## Important caveats

- `pipeline/ingest_contests.py` and `pipeline/ingest_sbe_candidates.py` depend on the current 2026 SBE page structure and may need selector updates if Maryland revises the markup.
- `pipeline/load_district_boundaries.py` still has a small residue of unmatched precinct codes caused by county-specific 2022 vs 2026 precinct-code differences.
- The precinct schema still uses `MultiPolygon`, which is appropriate and safe even though the Maryland layer is documented as polygon geometry.

## Stage 1 validation target

Stage 1 is complete when a real Maryland latitude/longitude passed to `lookup_ballot()` returns the expected upcoming contests from Supabase.

## Stage 2 next steps

1. `python -m pipeline.ingest_sbe_candidates`
2. `python -m pipeline.scrape_candidate_websites`
3. `python -m pipeline.enrich_candidates`
4. Build `compute_completeness.py`
