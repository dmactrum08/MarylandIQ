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

## AI backend options

All enrichment and generation scripts accept a `--backend` flag:

| Backend | Flag | Env var(s) required | Notes |
|---|---|---|---|
| Gemini (Google AI Studio) | `--backend gemini` | `GOOGLE_AI_STUDIO_API_KEY` | Free tier: 1000 req/day, 15 req/min |
| OpenRouter | `--backend openrouter` | `OPENROUTER_API_KEY`, optionally `OPENROUTER_MODEL` | Default model: `google/gemini-2.0-flash-exp:free` |
| LM Studio (local) | `--backend lmstudio` | optionally `LM_STUDIO_MODEL` | Requires LM Studio running at localhost:1234 |

For candidate enrichment and thin-candidate social inference, LM Studio is the default path in the codebase. Gemini and OpenRouter remain available as fallbacks.

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

## Stage 2 status — COMPLETE

All four Stage 2 scripts have been built and run successfully:

1. `python -m pipeline.ingest_sbe_candidates` ✅
2. `python -m pipeline.scrape_candidate_websites` ✅
3. `python -m pipeline.enrich_candidates` ✅
4. `python -m pipeline.compute_completeness` ✅

**Completeness scores as of 2026-04-09:** 777 candidates scored — full (≥60): 173, partial (40–59): 53, thin (<40): 551.

**Bug fixed in `compute_completeness.py`:** The `candidate_enrichment` query used `.in_()` with all candidate IDs, generating a URL too long for PostgREST. Fixed by replacing the two separate queries with a single embedded select (`candidate_enrichment(...)` joined in the candidates query).

## Stage 3 — Static Data: Office Explainers + Ballot Measures

### Office explainers

One-time Gemini batch (~12 distinct office types in the `offices` table).
Reads each office name, calls Gemini, stores in `offices.explainer_text`.

Run with:
```
python -m pipeline.generate_office_explainers
```

Use `--force` to regenerate explainers that already exist.
Use `--backend lmstudio` if LM Studio is running locally instead.

**Status:** Script built — not yet run.

### Ballot measures

**Schema migration — run once in Supabase SQL editor before first run:**
```sql
ALTER TABLE ballot_measures ALTER COLUMN jurisdiction_id DROP NOT NULL;
```
`NULL` jurisdiction_id = statewide measure (appears on all ballots).

Run with:
```
python -m pipeline.ingest_ballot_measures
```

**What it does on each run:**
1. Tries SBE ballot questions page — gracefully handles 404 (page not live yet)
2. Scrapes Ballotpedia `Maryland_2026_ballot_measures` — reliable fallback
3. Only ingests **certified** measures; logs potential/not-on-ballot and skips them
4. SBE text wins over Ballotpedia on slug collisions (more authoritative)
5. Upserts idempotently; clears cached summary if official text changed
6. Generates plain-language AI summaries for any new/updated measures

**2026 statewide measures status (as of April 2026):**
- SB0933 — Commission on Judicial Disabilities Vacancies — **CERTIFIED** ✅
- SB0005 — Special Election to Fill Legislative Vacancies — potential
- HB0638 — Raise Mandatory Judicial Retirement Age 70→73 — potential
- HB0821/SB0541 — Judicial Disqualification from Future Office — potential
- HB0488 — Congressional Redistricting/Supreme Court Jurisdiction — potential
- HB0604/SB0028 — Collective Bargaining for State Employees — potential
- HB1081 — MTA Authority to Acquire Property — potential

Use `--no-ai` to ingest data without generating summaries.
Use `--backend openrouter` or `--backend lmstudio` to change AI backend.

**Status:** Script built — schema migration needed before first run.

---

## Stage 2 — Thin Candidate Social Inference

551 candidates scored below 40. The next pipeline script is `scrape_social_media.py`, implementing the three-tier approach from the impl strategy (§4.5):

- **Tier 1:** Follow official social links already in the DB or scraped from the candidate website.
- **Tier 2:** Structured DuckDuckGo search (`{name} {office} {jurisdiction} Maryland 2026`) for candidates with no social links found. Facebook first, Twitter (API, 500 reads/month quota) as last resort, no LinkedIn search.
- **Tier 3:** LLM validation gate, using LM Studio locally by default — YES/NO/UNCERTAIN before storing anything. UNCERTAIN → null. False match is worse than blank.

Run with: `python -m pipeline.scrape_social_media`

Default behavior:
- `scrape_social_media.py` defaults to `--backend lmstudio`
- `enrich_candidates.py` also defaults to `--backend lmstudio` for the follow-up summary pass
- Set `LM_STUDIO_MODEL` in `.env` to the model you have loaded in LM Studio

## Remaining pipeline scripts to build

- `pipeline/detect_withdrawals.py` — diff SBE against DB; alert on status changes (Stage 5)
- `pipeline/trigger_build.py` — call Vercel deploy webhook after data changes (Stage 5)
- `pipeline/detect_withdrawals.py` — diff SBE against DB; alert on status changes (Stage 5)
- `pipeline/trigger_build.py` — call Vercel deploy webhook after data changes (Stage 5)

## Stage 4 — Frontend

Next.js 16 (App Router) + Tailwind CSS + Vercel. Scaffolded at `frontend/`.

**Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, pnpm, @supabase/supabase-js

**Local dev:**
```
cd frontend
pnpm dev
```

**Supabase client:** `frontend/lib/supabase.ts` — reads from `frontend/.env.local`.
Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (already set from pipeline .env).

**Vercel setup (when ready):**
1. Create Vercel project, connect GitHub repo
2. Set Root Directory to `frontend`
3. Add env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**Build order:**
1. `/` — home page + address input (ballot lookup front door)
2. `/api/ballot-lookup` — edge function: geocode → ST_Within → return contests
3. `/ballot` — lookup results page
4. `/races/[slug]` — race page with candidate list + office explainer
5. `/candidates/[slug]` — full candidate profile with trust labels
6. `/offices/[slug]` — office explainer page
7. `/measures/[slug]` — ballot measure + AI summary
8. `/search` — full-text candidate/race search
9. `/report` — corrections form

**Status:** Scaffolded. UI design review pending before building pages.

## Stage 5 — Ops

GitHub Actions workflows for event-driven refresh. Schedules per impl strategy §2.2: every 6 hours during filing period, weekly otherwise, every 2 hours on election day, off in dead periods.
