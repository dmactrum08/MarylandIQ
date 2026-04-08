# MarylandIQ Stage 1 Runbook

This project is currently in Stage 1: database foundation, precinct loading, contest loading, and ballot lookup validation.

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

## Important caveats

- `pipeline/ingest_contests.py` is still dependent on the 2026 SBE page structure and may need selector updates once the final page is live.
- `pipeline/load_district_boundaries.py` assumes the 2022 SBE precinct result filenames and field names are close to the current pattern. If Maryland changes those filenames or headers, adjust the parser before relying on the mapping output.
- The precinct schema still uses `MultiPolygon`, which is appropriate and safe even though the Maryland layer is documented as polygon geometry.

## Validation target

Stage 1 is complete when a real Maryland latitude/longitude passed to `lookup_ballot()` returns the expected upcoming contests from Supabase.
