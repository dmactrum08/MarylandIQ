# MarylandIQ

**Implementation Strategy**

*marylandiq.com — from zero to statewide, solo builder, near-zero cost*

**Version:** 1.0 \| **Scope:** Statewide, county-level races, 2026 cycle \| **Build:** Solo

## 1. Guiding Principles for a Solo Build
Before any architecture decision, these principles shape every tradeoff in this document.

- Data pipeline first, UI second. A beautiful front end on stale or wrong data is worse than an ugly front end on accurate data. Build and validate the full pipeline before touching the UI.

- Static over dynamic everywhere possible. Pre-render candidate and race pages at build time. The data changes rarely; there is no reason to compute it on every request.

- Free tier ceiling. Every infrastructure choice must be sustainable at \$0–20/month indefinitely. If a service requires a paid tier to hit a reasonable scale, replace it.

- Event-driven refresh, not nightly cron. Candidate data has three change windows per election cycle — filing period, withdrawal period, and post-election. Refresh only during those windows on a schedule matched to the actual change rate.

- Explicit trust over implicit inference. Every data field shown to a voter carries a label. The AI layer enriches; it does not invent. 'No information found' is always a valid and displayed state.

- Scope discipline. Municipal elections, campaign finance mirroring, and user accounts are not in scope. Every time a feature idea surfaces that is not in the PRD, write it down and move on.

## 2. System Overview
MarylandIQ is composed of four layers that are built in sequence. Each layer is independently testable before the next is added.

| **Layer**         | **What it is**                                                            | **Primary technology**                            | **Built in stage** |
|-------------------|---------------------------------------------------------------------------|---------------------------------------------------|--------------------|
| 1 — Data          | Pipeline that ingests, normalizes, enriches, and stores all election data | Python scripts + GitHub Actions + Supabase        | Stage 1–2          |
| 2 — AI Enrichment | LLM layer that summarizes, infers, and tags candidate content             | Gemini 2.0 Flash via Google AI Studio (free tier) | Stage 3            |
| 3 — Frontend      | Static site with ballot lookup, candidate pages, race pages               | Next.js (SSG) + Vercel                            | Stage 4            |
| 4 — Ops           | Refresh scheduling, alerting, corrections inbox                           | GitHub Actions + email                            | Stage 5            |

### 2.1 Data flow (end to end)
The following describes how data moves from source to voter screen:

> *Source (MD SBE / county board / candidate website / social media)*
>
> *→ Ingestion script — scrapes, parses, normalizes to internal schema*
>
> *→ Supabase (Postgres + PostGIS) — single source of truth*
>
> *→ Enrichment worker — LLM summarizes, tags, infers for thin candidates*
>
> *→ Build trigger — Next.js SSG pulls from Supabase, renders static pages*
>
> *→ Vercel CDN — serves pre-rendered pages globally*
>
> *→ Voter browser — sub-2s load, no runtime DB queries for candidate/race pages*

The only runtime database query is the ballot lookup (address → precinct → race IDs). Everything else is pre-rendered HTML.

### 2.2 Refresh strategy (not nightly cron)
Candidate data changes on a predictable schedule tied to the Maryland election calendar. Over-refreshing wastes GitHub Actions minutes and LLM tokens. Under-refreshing misses withdrawals.

| **Window**                        | **What changes**            | **Refresh schedule**          | **Trigger type** |
|-----------------------------------|-----------------------------|-------------------------------|------------------|
| Filing period open (Feb–Mar 2026) | New candidates appear daily | Every 6 hours                 | Scheduled cron   |
| Filing period closed → primary    | Rare withdrawals only       | Weekly                        | Scheduled cron   |
| Primary election week             | Results, potential runoffs  | Every 2 hours on election day | Scheduled cron   |
| Primary → general                 | Rare withdrawals            | Weekly                        | Scheduled cron   |
| General election week             | Results                     | Every 2 hours on election day | Scheduled cron   |
| Off-season (all other times)      | Nothing                     | Off — no scheduled runs       | Manual only      |

GitHub Actions cron schedules are activated and deactivated by editing the workflow YAML in the repository. The off-season 'no runs' state is the default; you manually enable the filing-period schedule before it opens.

## 3. Database Architecture
All data lives in a single Supabase project (Postgres with PostGIS enabled). The schema is designed around the query patterns the application actually needs: ballot lookup by address, candidate page by slug, race page by slug, and comparison by race ID.

### 3.1 Core tables
**jurisdictions**

Every geographic unit that runs elections: the 24 Maryland county jurisdictions (23 counties + Baltimore City). Referenced by contests and precincts.

| **Column**          | **Type**    | **Notes**                                    |
|---------------------|-------------|----------------------------------------------|
| id                  | uuid PK     |                                              |
| slug                | text UNIQUE | e.g. 'prince-georges-county'                 |
| name                | text        | e.g. 'Prince George's County'                |
| type                | text        | 'county' \| 'city'                           |
| sbe_jurisdiction_id | text        | MD SBE internal ID for this jurisdiction     |
| county_board_url    | text        | Homepage of this county's board of elections |

**offices**

The office types that appear on 2026 ballots. Decoupled from jurisdictions because the same office type (e.g. Board of Education) appears in multiple counties.

| **Column**             | **Type**    | **Notes**                                          |
|------------------------|-------------|----------------------------------------------------|
| id                     | uuid PK     |                                                    |
| slug                   | text UNIQUE | e.g. 'county-executive', 'board-of-education'      |
| name                   | text        | Display name                                       |
| explainer_text         | text        | Plain-English description of what this office does |
| explainer_source       | text        | 'official' \| 'ai_generated'                       |
| explainer_generated_at | timestamptz | When the AI explainer was last generated           |

**contests**

A specific race in a specific jurisdiction and district in a specific election. One contest = one ballot line.

| **Column**      | **Type**                | **Notes**                                        |
|-----------------|-------------------------|--------------------------------------------------|
| id              | uuid PK                 |                                                  |
| slug            | text UNIQUE             | e.g. 'pg-county-council-district-4-2026-primary' |
| office_id       | uuid FK → offices       |                                                  |
| jurisdiction_id | uuid FK → jurisdictions |                                                  |
| district_name   | text nullable           | e.g. 'District 4', null for at-large races       |
| election_date   | date                    | 2026-06-23 (primary) or 2026-11-03 (general)     |
| election_type   | text                    | 'primary' \| 'general' \| 'special'              |
| seats_available | integer                 | Usually 1; some at-large races have more         |
| sbe_contest_id  | text                    | MD SBE internal ID; used for change detection    |
| last_scraped_at | timestamptz             | When this record was last refreshed from SBE     |

**precincts**

Maryland's voting precincts. The geometry column holds the actual polygon used for address-to-precinct matching. PostGIS is required for the ST_Within() query.

| **Column**      | **Type**                | **Notes**                                         |
|-----------------|-------------------------|---------------------------------------------------|
| id              | uuid PK                 |                                                   |
| precinct_code   | text                    | MD SBE precinct identifier                        |
| jurisdiction_id | uuid FK → jurisdictions |                                                   |
| geometry        | geometry(Polygon, 4326) | WGS84 polygon — PostGIS type                      |
| source_url      | text                    | ArcGIS REST endpoint this polygon was pulled from |
| loaded_at       | timestamptz             | Boundary data changes rarely; track when loaded   |

**precinct_contests**

Junction table: which contests appear on a given precinct's ballot. This is the join that powers the ballot lookup.

| **Column**  | **Type**            | **Notes**                     |
|-------------|---------------------|-------------------------------|
| precinct_id | uuid FK → precincts |                               |
| contest_id  | uuid FK → contests  | Composite PK with precinct_id |

**candidates**

One row per candidate per contest. A candidate running in both primary and general gets two rows (different contest_ids).

| **Column**            | **Type**             | **Notes**                                                        |
|-----------------------|----------------------|------------------------------------------------------------------|
| id                    | uuid PK              |                                                                  |
| slug                  | text UNIQUE          | e.g. 'jane-smith-pg-council-d4-2026-primary'                     |
| contest_id            | uuid FK → contests   |                                                                  |
| full_name             | text                 |                                                                  |
| party                 | text nullable        | 'Democratic' \| 'Republican' \| 'Green' \| etc.                  |
| filing_status         | text                 | 'Active' \| 'Withdrawn' \| 'Disqualified'                        |
| filed_date            | date                 |                                                                  |
| sbe_candidate_id      | text                 | MD SBE internal ID; key for change detection                     |
| campaign_website_url  | text nullable        |                                                                  |
| facebook_url          | text nullable        |                                                                  |
| twitter_handle        | text nullable        |                                                                  |
| linkedin_url          | text nullable        |                                                                  |
| completeness_score    | integer 0–100        | Computed field; triggers thin-candidate pipeline below threshold |
| last_scraped_at       | timestamptz          |                                                                  |
| withdrawn_detected_at | timestamptz nullable | Set when status flips to Withdrawn; triggers alert               |

**candidate_enrichment**

AI-generated and scraped enrichment data. Kept in a separate table so that the official candidate record is never overwritten by AI output.

| **Column**            | **Type**                | **Notes**                                                        |
|-----------------------|-------------------------|------------------------------------------------------------------|
| candidate_id          | uuid PK FK → candidates | One-to-one                                                       |
| ai_summary            | text nullable           | 2–4 sentence plain-English summary                               |
| ai_summary_sources    | jsonb                   | Array of {url, label} objects — evidence links                   |
| inferred_from_social  | boolean                 | True if summary was derived from social media only               |
| social_inference_text | text nullable           | Raw extracted text from social profiles before summarization     |
| issue_tags            | text\[\]                | e.g. \['Education', 'Housing', 'Public Safety'\]                 |
| issue_tag_sources     | jsonb                   | Per-tag source evidence: {tag, url, quote_snippet}               |
| website_scraped_at    | timestamptz nullable    |                                                                  |
| social_scraped_at     | timestamptz nullable    |                                                                  |
| ai_generated_at       | timestamptz nullable    |                                                                  |
| enrichment_version    | integer                 | Increment when prompt or logic changes; enables re-run targeting |

**ballot_measures**

| **Column**             | **Type**                | **Notes**                        |
|------------------------|-------------------------|----------------------------------|
| id                     | uuid PK                 |                                  |
| slug                   | text UNIQUE             |                                  |
| jurisdiction_id        | uuid FK → jurisdictions |                                  |
| title                  | text                    | Official measure title           |
| official_text          | text                    | Full official text               |
| plain_language_summary | text nullable           | AI-generated, cached             |
| summary_generated_at   | timestamptz nullable    |                                  |
| source_url             | text                    | Link to official source document |
| election_date          | date                    |                                  |

**corrections**

Stores submissions from the 'Report an issue' form. Reviewed manually for MVP.

| **Column**     | **Type**             | **Notes**                                          |
|----------------|----------------------|----------------------------------------------------|
| id             | uuid PK              |                                                    |
| page_url       | text                 | URL of the page the report came from               |
| reporter_email | text nullable        | Optional                                           |
| issue_type     | text                 | 'wrong_info' \| 'outdated' \| 'missing' \| 'other' |
| description    | text                 | Free-text from reporter                            |
| status         | text                 | 'open' \| 'resolved' \| 'dismissed'                |
| created_at     | timestamptz          |                                                    |
| resolved_at    | timestamptz nullable |                                                    |

### 3.2 Key indexes and PostGIS setup
- Enable PostGIS on your Supabase project: run CREATE EXTENSION IF NOT EXISTS postgis; in the SQL editor. This is a one-time step.

- Spatial index on precincts.geometry: CREATE INDEX precincts_geom_idx ON precincts USING GIST(geometry); — required for ST_Within() queries to be fast.

- Index on candidates.sbe_candidate_id for change detection during scrape runs.

- Index on candidates.contest_id for race page queries.

- Index on candidate_enrichment.completeness_score for thin-candidate pipeline queries.

- Index on contests.election_date + election_type for ballot lookup filtering.

### 3.3 The ballot lookup query
This is the only runtime database query in the application. Everything else is pre-rendered. The query runs when a voter submits their address.

> -- Step 1: find the precinct containing the geocoded point
>
> SELECT p.id, p.precinct_code, p.jurisdiction_id
>
> FROM precincts p
>
> WHERE ST_Within(ST_SetSRID(ST_Point(:lng, :lat), 4326), p.geometry)
>
> LIMIT 1;
>
> -- Step 2: get all contests on that precinct's ballot
>
> SELECT c.slug, c.election_type, c.election_date,
>
> o.name AS office_name, c.district_name
>
> FROM precinct_contests pc
>
> JOIN contests c ON c.id = pc.contest_id
>
> JOIN offices o ON o.id = c.office_id
>
> WHERE pc.precinct_id = :precinct_id
>
> AND c.election_date \>= CURRENT_DATE
>
> ORDER BY c.election_date, o.name;

The two-step structure means that Step 2 can use a regular B-tree index on precinct_id — only Step 1 needs the spatial index.

## 4. Data Pipeline Architecture
The pipeline is a collection of Python scripts orchestrated by GitHub Actions. Each script has a single responsibility and can be run independently for testing. No pipeline framework (Airflow, Prefect) is needed at this scale.

### 4.1 Script inventory
| **Script**                   | **Runs during**                   | **Responsibility**                                                                                                               |
|------------------------------|-----------------------------------|----------------------------------------------------------------------------------------------------------------------------------|
| ingest_sbe_candidates.py     | Filing period + weekly            | Scrape MD SBE candidate list; upsert to candidates table; detect new/changed/withdrawn                                           |
| ingest_contests.py           | Once + after SBE updates          | Build contests and offices tables from SBE race listings                                                                         |
| load_precinct_boundaries.py  | Once (rerun if boundaries update) | Fetch GeoJSON from ArcGIS REST; load into precincts; build precinct_contests mapping                                             |
| scrape_candidate_websites.py | On new candidate detected         | Fast path (requests) first, Playwright fallback for JS sites; 5 concurrent workers; ~12–15 min for full run                      |
| scrape_social_media.py       | Weekly for thin candidates        | 3-tier pipeline: follow official links → structured search with office+jurisdiction signals → LLM validation gate before storage |
| enrich_candidates.py         | After scrape completes            | Send scraped content to Gemini 2.0 Flash; store summary, tags, sources                                                           |
| compute_completeness.py      | After any enrichment run          | Score each candidate 0–100; update completeness_score column                                                                     |
| detect_withdrawals.py        | Every 2 hrs on election week      | Diff current SBE data against DB; flag status changes; send alert                                                                |
| trigger_build.py             | After any data change             | Call Vercel deploy hook to rebuild static pages                                                                                  |

### 4.2 Ingest SBE candidates — algorithm
This is the most critical script and runs most frequently. The key design is idempotent upsert with change detection.

> *ALGORITHM: ingest_sbe_candidates.py*
>
> 1\. Fetch the MD SBE candidate listing page(s) for the 2026 cycle
>
> using requests + BeautifulSoup. No JS rendering needed for SBE.
>
> 2\. Parse each candidate row into a normalized dict:
>
> { sbe_candidate_id, full_name, office, district, party,
>
> filing_status, filed_date, website_url, social_links }
>
> 3\. For each parsed candidate:
>
> a\. Look up existing record by sbe_candidate_id
>
> b\. If NOT found → INSERT new record; flag as 'new_candidate'
>
> c\. If found AND filing_status changed to 'Withdrawn':
>
> UPDATE status + set withdrawn_detected_at = now()
>
> Flag as 'withdrawal_detected'
>
> d\. If found AND website/social URLs changed:
>
> UPDATE URLs; flag as 'needs_rescrape'
>
> e\. If found AND no changes → skip (no DB write)
>
> 4\. After all upserts, collect flagged candidates:
>
> \- 'new_candidate' → queue for website scrape + enrichment
>
> \- 'withdrawal_detected' → send alert (email / webhook)
>
> \- 'needs_rescrape' → queue for website scrape + enrichment
>
> 5\. Write a run summary to a log table:
>
> { run_at, candidates_processed, new_detected,
>
> withdrawals_detected, errors }
>
> 6\. If any new_candidate or needs_rescrape: trigger build

### 4.3 Load precinct boundaries — algorithm
This runs once to populate the geospatial layer. It is the most complex script but only needs to run again if Maryland redraws precinct boundaries (unlikely mid-cycle).

> *ALGORITHM: load_precinct_boundaries.py*
>
> 1\. For each of Maryland's 24 county jurisdictions:
>
> a\. Construct the ArcGIS REST query URL:
>
> {featureserver_base}/{layer_id}/query
>
> ?where=JURISDICTION='{county_name}'
>
> &outFields=PRECINCT_CODE,JURISDICTION
>
> &returnGeometry=true
>
> &f=geojson
>
> b\. Paginate if result count = max (usually 1000/page)
>
> using resultOffset parameter
>
> c\. Parse each feature → { precinct_code, jurisdiction_id,
>
> geometry_geojson }
>
> 2\. Upsert all precincts into the precincts table.
>
> Use ST_GeomFromGeoJSON() to convert to PostGIS geometry.
>
> 3\. Build precinct_contests mapping:
>
> For each precinct, determine which contests apply.
>
> Approach: join by jurisdiction_id first (county-wide races
>
> apply to all precincts in that jurisdiction).
>
> District races require a separate district boundary layer
>
> — use the same ArcGIS pattern with the district layer.
>
> 4\. Validate: for a sample of known addresses,
>
> verify ST_Within returns the expected precinct.
>
> If validation fails, log and alert before writing to DB.

### 4.4 Scrape candidate websites — algorithm
The scraper uses a two-path strategy: a fast path (requests + BeautifulSoup) tried first, with Playwright as the fallback only for JS-rendered sites. All candidates are scraped concurrently with a pool of 5 workers, keeping a full initial run under 15 minutes on GitHub Actions. Raw text is cached — re-scraping only happens when a URL changes or a candidate is flagged.

> *TIMING ESTIMATES (500 candidates, 5 concurrent workers)*
>
> Fast path (requests): ~1–2s per candidate → covers ~60% of sites
>
> Playwright fallback: ~8–12s per candidate → covers remaining 40%
>
> Full initial run: ~12–15 minutes total
>
> Refresh run (20–30 new/changed candidates): ~3–5 minutes
>
> GitHub Actions budget: well under 2,000 free min/month
>
> *ALGORITHM: scrape_candidate_websites.py*
>
> 1\. Query candidates WHERE campaign_website_url IS NOT NULL
>
> AND (website_scraped_at IS NULL
>
> OR candidate is flagged 'needs_rescrape')
>
> 2\. Split into a work queue. Launch a ThreadPoolExecutor
>
> with max_workers=5. Each worker runs scrape_one(candidate).
>
> 3\. scrape_one(candidate) — fast path first:
>
> a\. Try requests.get(url, timeout=8) + BeautifulSoup
>
> b\. Extract text from: main, article, .about,
>
> .platform, .issues — fall back to body
>
> c\. If extracted text length \> 300 chars: fast path succeeded.
>
> → Store text, set scrape_method='requests', done.
>
> 4\. scrape_one(candidate) — Playwright fallback:
>
> (Triggered when fast path returns \< 300 chars,
>
> indicating a JS-rendered site)
>
> a\. Launch async Playwright browser (chromium, headless)
>
> b\. page.goto(url, timeout=15000)
>
> c\. page.wait_for_load_state('networkidle')
>
> d\. Extract text from same selectors as fast path
>
> e\. Store text, set scrape_method='playwright'
>
> 5\. After extraction (either path):
>
> a\. Truncate to 8,000 tokens (LLM context budget)
>
> b\. Store in candidate_enrichment.scraped_website_text
>
> c\. Set website_scraped_at = now()
>
> d\. Respect robots.txt: check on first visit per domain,
>
> cache result — skip scrape and log if disallowed
>
> 6\. On error (timeout, 404, connection refused):
>
> Log error type; set website_scraped_at = now() with
>
> scrape_error flag. Do not retry more than 2x per cycle.
>
> 7\. After all workers complete, trigger enrich_candidates.py
>
> for all newly scraped candidates.

### 4.5 Social media inference — algorithm
Only runs for candidates whose completeness_score is below 40. Uses a three-tier approach: follow official links first (zero ambiguity), structured search second (strong signals beyond name alone), then LLM validation before anything is stored. A false match is worse than a blank field — when in doubt, store null.

> *TIER 1 — Follow official links (no search needed, zero false-match risk)*
>
> Source 1: Maryland SBE filing
>
> → SBE sometimes includes social URLs directly in the candidate record.
>
> → Extract during ingest_sbe_candidates.py and store in candidates table.
>
> Source 2: Candidate website (already scraped in 4.4)
>
> → Parse the scraped HTML for social link patterns:
>
> facebook.com/, twitter.com/, x.com/, linkedin.com/in/,
>
> instagram.com/ in \<a href\> tags
>
> → Store any found URLs in candidates.facebook_url,
>
> candidates.twitter_handle, candidates.linkedin_url
>
> → This covers the majority of candidates who have any
>
> social presence — most campaign sites link their pages.
>
> *TIER 2 — Structured search (only for remaining thin candidates)*
>
> Triggered when: completeness_score \< 40 AND no social URLs found in Tier 1
>
> Search query construction — never name alone:
>
> query = f'{full_name} {office_name} {jurisdiction} Maryland 2026'
>
> e.g.: 'Jane Doe Board of Education Prince George County Maryland 2026'
>
> FACEBOOK:
>
> Search via DuckDuckGo (free, no API):
>
> site:facebook.com '{full_name}' '{jurisdiction}'
>
> Look for results where the page title or description
>
> explicitly mentions the office or candidacy.
>
> Only proceed to Tier 3 validation if a plausible match found.
>
> X / TWITTER:
>
> Use Twitter API v2 free tier (500 reads/month):
>
> Search: '{full_name} {office_name} Maryland'
>
> Only use if candidate has no Facebook match —
>
> conserve the monthly quota for highest-value lookups.
>
> LINKEDIN:
>
> Only follow direct linkedin_url links found in Tier 1.
>
> Do not search LinkedIn by name — too many false matches,
>
> and LinkedIn is more aggressive about blocking scrapers.
>
> *TIER 3 — LLM validation before storage (critical gate)*
>
> For every candidate social profile found in Tier 2:
>
> Send to Gemini with a binary validation prompt:
>
> ---
>
> Candidate on file: {full_name}, running for {office_name}
>
> in {jurisdiction}, Maryland, 2026 election.
>
> Social profile found: {profile_name}, {profile_bio},
>
> {recent_post_snippets}
>
> Does this social profile clearly belong to this specific
>
> candidate running for this specific office?
>
> Answer only: YES, NO, or UNCERTAIN.
>
> ---
>
> If YES: store profile URL + scraped content, label as
>
> 'inferred from public social media'
>
> If NO: discard entirely, store null
>
> If UNCERTAIN: discard, store null
>
> ('no verified social presence found' is the
>
> honest and safe answer)
>
> *CONCURRENCY + TIMING*
>
> Run Tier 2+3 with ThreadPoolExecutor, max_workers=3
>
> (lower than website scraping — social sites rate-limit more aggressively)
>
> Estimated time for 150 thin candidates: ~20–30 minutes
>
> This runs as a separate weekly job, not blocking the main pipeline.
>
> *FINAL STEP — concatenate and gate*
>
> After Tier 1 + 2 + 3 complete for a candidate:
>
> Concatenate all verified social text into
>
> candidate_enrichment.social_inference_text
>
> Set social_scraped_at = now()
>
> If total verified text \< 100 words:
>
> Set inferred_from_social = false
>
> Do NOT trigger LLM enrichment for social content
>
> Display: 'No verified public social presence found'
>
> If total verified text \>= 100 words:
>
> Flag candidate for enrich_candidates.py run

### 4.6 LLM enrichment — algorithm and prompts
This is where Gemini 2.0 Flash generates the content voters see. Every generation is sourced and cached. Google AI Studio's free tier allows up to 1,000 requests/day — more than sufficient for the MVP enrichment pipeline. Context caching on repeated system prompts keeps costs at zero.

> *ALGORITHM: enrich_candidates.py*
>
> 1\. Query candidates needing enrichment:
>
> WHERE (ai_generated_at IS NULL
>
> OR enrichment_version \< CURRENT_VERSION)
>
> AND (scraped_website_text IS NOT NULL
>
> OR social_inference_text IS NOT NULL)
>
> 2\. Initialize Gemini client:
>
> import google.generativeai as genai
>
> genai.configure(api_key=os.environ\['GOOGLE_AI_STUDIO_API_KEY'\])
>
> model = genai.GenerativeModel(
>
> model_name='gemini-2.0-flash',
>
> system_instruction=SYSTEM_PROMPT \# set once, reused across calls
>
> )
>
> 3\. SYSTEM_PROMPT (set once on model init):
>
> You are a factual summarizer for a nonpartisan voter
>
> information platform. You extract and summarize only
>
> what candidates have explicitly stated. You never invent
>
> positions. If information is insufficient, return null
>
> for that field. Always return valid JSON with no markdown
>
> fences or preamble.
>
> 4\. For each candidate, build the user prompt:
>
> Candidate: {full_name}
>
> Office: {office_name}, {jurisdiction}
>
> Sources provided: {list of source URLs}
>
> ---- WEBSITE TEXT ----
>
> {scraped_website_text \| 'none'}
>
> ---- SOCIAL MEDIA TEXT ----
>
> {social_inference_text \| 'none'}
>
> ----
>
> Return JSON with these fields:
>
> {
>
> summary: string (2-4 sentences) \| null,
>
> issue_tags: string\[\] (from approved list only),
>
> issue_tag_evidence: \[{tag, quote_snippet, source_url}\],
>
> inferred_from_social: boolean,
>
> confidence: 'high' \| 'medium' \| 'low'
>
> }
>
> 5\. Call the API:
>
> response = model.generate_content(user_prompt)
>
> raw = response.text
>
> 6\. Parse the JSON response. Validate all issue_tags are
>
> from the approved list (prevents hallucinated tags).
>
> 7\. Write results to candidate_enrichment table.
>
> Set ai_generated_at = now()
>
> Set enrichment_version = CURRENT_VERSION
>
> 8\. Recompute completeness_score for updated candidates.
>
> 9\. Trigger build if any candidate pages changed.
>
> Rate limit awareness: AI Studio free tier = 15 req/min, 1000/day.
>
> Add time.sleep(4) between calls to stay under the per-minute limit.

### 4.7 Completeness scoring
A simple weighted score (0–100) determines whether a candidate is 'thin' and needs social inference, and controls UI badge display.

> *SCORING: compute_completeness.py*
>
> score = 0
>
> if official_fields_complete (name, party, status, filed_date): +20
>
> if campaign_website_url is set: +15
>
> if website_scraped_text length \> 200 chars: +20
>
> if ai_summary is not null: +20
>
> if issue_tags count \>= 2: +15
>
> if social_links (any of FB/Twitter/LinkedIn) is set: +10
>
> completeness_score = min(score, 100)
>
> Threshold rules:
>
> \>= 60: full display, no 'limited info' badge
>
> 40–59: show available info + 'some info unavailable' badge
>
> \< 40: trigger social inference pipeline on next weekly run

## 5. Frontend Architecture
### 5.1 Technology choices
| **Decision**    | **Choice**                                         | **Rationale**                                                                     |
|-----------------|----------------------------------------------------|-----------------------------------------------------------------------------------|
| Framework       | Next.js (App Router)                               | SSG + ISR out of the box; Vercel deploy is one command; strong TypeScript support |
| Rendering       | Static Site Generation (SSG)                       | Candidate/race pages pre-rendered at build time; no DB hit at runtime             |
| Styling         | Tailwind CSS                                       | No runtime overhead; fast to build with; pairs well with component-based layout   |
| Ballot lookup   | Client-side API call to Vercel serverless function | Only runtime DB query in the app; small edge function calling Supabase            |
| Database client | Supabase JS SDK                                    | Typed client; handles auth (for admin) and anonymous queries                      |
| Hosting         | Vercel free tier                                   | Native Next.js support; 100GB bandwidth; unlimited SSG rebuilds                   |
| Search          | Supabase full-text search via API route            | Postgres tsvector; no Algolia needed at MVP scale                                 |

### 5.2 Page types and rendering strategy
| **Page**                | **Rendering**                    | **Data source**                                     |
|-------------------------|----------------------------------|-----------------------------------------------------|
| / (home)                | Static                           | No DB — static copy + search bar                    |
| /ballot (lookup result) | Client-side after address submit | Vercel edge function → Supabase ST_Within query     |
| /races/\[slug\]         | SSG at build time                | getStaticProps pulls from Supabase at build         |
| /candidates/\[slug\]    | SSG at build time                | getStaticProps pulls full enriched candidate record |
| /offices/\[slug\]       | SSG at build time                | Static office explainer content                     |
| /measures/\[slug\]      | SSG at build time                | Ballot measure + AI summary                         |
| /search                 | Client-side                      | API route → Supabase full-text search               |
| /report                 | Client-side form submit          | API route → INSERT into corrections table           |

### 5.3 Ballot lookup — client flow
> *ALGORITHM: ballot lookup (client + edge function)*
>
> CLIENT:
>
> 1\. User types address → autocomplete via Census address suggest API
>
> 2\. User selects address → POST to /api/ballot-lookup
>
> with { address_string, election_type }
>
> EDGE FUNCTION (/api/ballot-lookup):
>
> 3\. Call Census Geocoder API with address_string
>
> → returns { lat, lng, matched_address }
>
> 4\. If geocode fails: return { error: 'address_not_found' }
>
> 5\. Run the two-step Supabase query (section 3.3 above)
>
> → returns list of contest slugs + office names
>
> 6\. Return { matched_address, contests: \[{slug, office_name,
>
> district_name, election_date, candidate_count}\] }
>
> CLIENT (on response):
>
> 7\. Render the ballot as a list of contest cards
>
> 8\. Each card links to /races/{slug}
>
> 9\. Show 'Why am I seeing this race?' expandable per contest
>
> (displays: district name + link to official boundary source)

### 5.4 Candidate page layout
The candidate page is the core UI. The layout should make trust labels unavoidable — not hidden in footnotes.

- Header: name, office, district, election date, filing status badge (Active / Withdrawn).

- Trust badge legend: always visible at the top of the content area — small colored dots with labels (Official, Candidate-submitted, AI summary, Inferred from social).

- Official Filing Facts section: status, party, filed date, SBE candidate ID link. Trust badge: Official.

- Campaign Presence section: website link + extracted key content. Social profile links. Trust badge: Candidate-submitted.

- AI Summary section: 2–4 sentences. Expandable 'How was this generated?' explains the source text. Trust badge: AI summary. Hidden if summary is null.

- Inferred from Social section: only shown if inferred_from_social = true AND completeness \< 60. Each extracted point links to its source. Trust badge: Inferred from social.

- Issue Tags section: colored tag chips. Each chip is clickable and shows a popover with the source evidence snippet. Hidden if no tags.

- Compare in this race: button linking to /races/{slug}#compare.

- Finance & Disclosure: linked button to MD SBE finance DB filtered to this candidate.

- Report an error: always visible at the bottom. Opens inline form.

- Last updated: small timestamp at the bottom of the page showing when data was last refreshed.

## 6. Staged Build Order
This is the sequence that gets you to a working, publicly useful product as fast as possible. Each stage ends with something testable and shippable on its own.

> **STAGE 1** Foundation — Database + Boundaries

**GOAL: SUPABASE IS RUNNING, PRECINCT BOUNDARIES ARE LOADED, BALLOT LOOKUP QUERY WORKS.**

- Create the Supabase project. Enable PostGIS. Run CREATE EXTENSION IF NOT EXISTS postgis;

- Create all tables from Section 3 using Supabase's SQL editor. Start with: jurisdictions → offices → contests → precincts → precinct_contests → candidates → candidate_enrichment → ballot_measures → corrections.

- Seed jurisdictions: manually insert Maryland's 24 county jurisdictions (this is a one-time 24-row insert, not worth scripting).

- Write and run load_precinct_boundaries.py: fetch GeoJSON from Maryland's ArcGIS REST FeatureServer for all 24 jurisdictions; upsert precincts table.

- Validate boundaries: pick 5 known addresses in different jurisdictions; run the ST_Within query manually in Supabase SQL editor; verify each returns the correct precinct.

- Write and run ingest_contests.py: scrape the Maryland SBE 'Offices up for Election 2026' page; populate offices and contests tables.

- Build the precinct_contests mapping: for county-wide races, JOIN all precincts in a jurisdiction to the contest; for district races, use the district boundary layer (same ArcGIS pattern).

> *Deliverable: You can run the ballot lookup SQL query against a real Maryland address and get back a list of real 2026 contests. The rest of the platform builds on this.*
>
> **STAGE 2** Candidate Data — Ingest + Enrich

**GOAL: ALL CANDIDATES IN THE DB WITH OFFICIAL DATA; ENRICHMENT PIPELINE RUNNING.**

- Write and run ingest_sbe_candidates.py: scrape the MD SBE 2026 candidate listing; upsert all candidates into the candidates table. Implement the change detection logic (Section 4.2) from the start — you want it ready before the filing period opens.

- Write scrape_candidate_websites.py with the two-path strategy: fast path (requests + BeautifulSoup) first, Playwright fallback only when the fast path returns less than 300 characters. Use ThreadPoolExecutor with 5 workers for concurrency. Store raw text in candidate_enrichment.

- Set up your Google AI Studio API key as a GitHub Actions secret and a local .env variable. Get it free at aistudio.google.com — no billing required. Test a single enrichment call with a real candidate's scraped text before running the full pipeline.

- Write enrich_candidates.py: implement the prompt from Section 4.6; parse JSON response; validate issue tags against approved list; write to candidate_enrichment.

- Write compute_completeness.py: implement the scoring from Section 4.7; run against all candidates.

- Identify thin candidates (completeness \< 40). Write and run scrape_social_media.py using the three-tier approach: official links first (zero false-match risk), structured search with office+jurisdiction signals second, LLM validation gate before any content is stored. Run on a sample of ~20 candidates first and manually verify the validation is rejecting false matches before running at scale.

- Run enrich_candidates.py for thin candidates after social scrape.

- Write detect_withdrawals.py: compare current SBE data against DB; log diffs; send an email alert when a withdrawal is detected (use Python's smtplib with a free Gmail app password for MVP — no SendGrid needed yet).

> *Deliverable: All 2026 county-level candidates are in the DB with official data. The majority have AI summaries. Thin candidates have social inference content where available.*
>
> **STAGE 3** Static Data — Explainers + Ballot Measures

**GOAL: OFFICE EXPLAINERS AND BALLOT MEASURES READY; ALL STATIC CONTENT COMPLETE.**

- Generate office explainers: for each distinct office in the offices table, run a single Gemini 2.0 Flash call with the official SBE office description as input; store result in offices.explainer_text. This is a one-time batch run (~15 offices).

- Ingest ballot measures: scrape the relevant county board pages for any measures on the 2026 ballot; populate ballot_measures table.

- Generate plain-language summaries for ballot measures: one LLM call per measure; cache in ballot_measures.plain_language_summary.

- Define the approved issue tag list: compile ~20 tags relevant to Maryland local races (Education, Housing, Public Safety, Transportation, Environment, Fiscal Policy, etc.). Hard-code this list in the enrichment script's validation step.

> *Deliverable: Every page type has complete data. A full site build would produce a useful, complete output.*
>
> **STAGE 4** Frontend — Build the Site

**GOAL: WORKING NEXT.JS SITE DEPLOYED TO VERCEL WITH ALL PAGE TYPES FUNCTIONAL.**

- Initialize Next.js project with TypeScript and Tailwind CSS. Connect to Supabase using the JS SDK.

- Build the ballot lookup first: home page with address input → /api/ballot-lookup edge function → result page showing the voter's contests. Test with real addresses. This is the most important user journey.

- Build the /races/\[slug\] page: getStaticPaths pulls all contest slugs; getStaticProps pulls the full contest record + candidate list. Add the office explainer card and comparison table.

- Build the /candidates/\[slug\] page: full candidate profile with trust labels as described in Section 5.4. This is the most complex UI component. Build the trust badge legend first, then add each section.

- Build the /offices/\[slug\] page: simple explainer page — one of the easiest builds.

- Build the /measures/\[slug\] page: official text + AI summary + source link.

- Build the /search page: address bar plus keyword search using Supabase full-text search on candidate names, office names, and jurisdiction names.

- Build the /report page and API route: simple form → POST to /api/report → INSERT into corrections table.

- Deploy to Vercel: connect GitHub repository; set SUPABASE_URL and SUPABASE_ANON_KEY environment variables; push to main branch.

- Run a full site build and manually verify 10–15 candidate pages across different counties and completeness levels.

> *Deliverable: The site is live. Real voters can use it.*
>
> **STAGE 5** Operations — Scheduling + Alerting

**GOAL: DATA STAYS FRESH WITHOUT MANUAL INTERVENTION DURING ELECTION WINDOWS.**

- Write the GitHub Actions workflow files: one workflow per script; use cron schedule syntax. Keep each workflow independently triggerable (workflow_dispatch: true) so you can run any script manually.

- Implement the schedule matrix from Section 2.2: the filing-period workflow (every 6 hours) and the weekly refresh workflow. Both are disabled by default; you enable them by pushing a workflow file change.

- Add a Vercel deploy hook: a webhook URL that triggers a site rebuild. Call this URL at the end of any pipeline run that changed data. Store the hook URL as a GitHub Actions secret.

- Monitor API usage on Google AI Studio: check the usage dashboard periodically. The free tier (1,000 requests/day) has a hard ceiling — if you ever hit it, the pipeline will queue and retry the next day. At MVP scale this should never be an issue.

- Add a run summary log: after each pipeline run, write a row to a pipeline_runs table (run_at, script_name, candidates_processed, errors, duration_seconds). This is your operational dashboard — query it in Supabase's table view.

- Test the withdrawal alert end-to-end: temporarily set a test candidate's status to 'Withdrawn' in the DB; run detect_withdrawals.py; verify you receive the alert email.

> *Deliverable: The platform is self-sustaining during election windows. You can go offline for a week and data will stay fresh automatically.*

## 7. Key Algorithms Summary
Quick reference for the core logic patterns used throughout the platform.

| **Algorithm**            | **Pattern**                                                                                                                                                                                                                    |
|--------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Ballot lookup            | Geocode address → ST_Within against precinct polygons → JOIN to contests via precinct_contests                                                                                                                                 |
| Change detection         | Hash or compare key fields (status, URLs) per sbe_candidate_id; flag diffs rather than overwriting blindly                                                                                                                     |
| Website scraping         | Fast path (requests + BS4) → check extracted length → Playwright fallback if \< 300 chars; 5 concurrent workers; robots.txt respected                                                                                          |
| Social media discovery   | Tier 1: follow official links from SBE + website HTML; Tier 2: structured DuckDuckGo search (name + office + jurisdiction, never name alone); Tier 3: LLM binary YES/NO validation before storage — UNCERTAIN defaults to null |
| LLM enrichment           | System prompt sent with each call (AI Studio free tier has no explicit prompt caching but Flash is fast enough to not need it); per-candidate content in user turn; JSON response with approved-list validation                |
| Precinct→contest mapping | County-wide: all precincts in jurisdiction → all county-wide contests; District: spatial join of precinct centroid to district polygon                                                                                         |
| Static site rebuild      | Any pipeline run that modifies candidate/contest data calls Vercel deploy hook webhook URL; full SSG rebuild takes ~2–3 minutes                                                                                                |
| Social inference gate    | Collect text → if total \< 100 words: store null, show 'no info found'; if \>= 100 words: run LLM extraction; always label output as inferred                                                                                  |

## 8. Risks & Mitigations
| **Risk**                                                                      | **Likelihood** | **Mitigation**                                                                                                                                                                         |
|-------------------------------------------------------------------------------|----------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| MD SBE changes its HTML structure mid-cycle, breaking the scraper             | Medium         | Store raw HTML in an S3-compatible bucket (Supabase Storage, free tier) on every run; you can re-parse historical data without re-scraping if the parser breaks                        |
| ArcGIS REST endpoint changes or goes offline                                  | Low            | Precinct boundaries are loaded once; cached in your DB. Not a live dependency after initial load.                                                                                      |
| LLM generates inaccurate summary for a candidate                              | Medium         | Trust labels + corrections form are the safety valve. Monitor correction report rate; if a category of errors appears, add a rule to the prompt.                                       |
| Twitter API free tier (500 reads/month) exhausted mid-cycle                   | High           | Prioritize thin candidates; fall back to Facebook + LinkedIn only if limit hit. Most candidates have at least one non-Twitter social presence.                                         |
| Supabase free tier storage limit (500MB) exceeded by precinct geometry        | Medium         | Maryland's 24 jurisdictions × ~500 precincts each = ~12,000 polygons. At ~5KB/polygon, total geometry is ~60MB — well within the 500MB limit.                                          |
| Candidate disputes AI-generated summary                                       | Low–Medium     | Corrections form routes to your email; you can manually override any AI field via a data override column in candidate_enrichment. Override values take precedence over generated ones. |
| Vercel free tier bandwidth (100GB) exceeded during high-traffic election week | Low for MVP    | SSG pages are extremely light. 100GB = roughly 500,000 page views at 200KB/page. Upgrade to \$20/month Pro if you hit this.                                                            |

## 9. External Dependency Map
Every external dependency this platform relies on, its cost, and what breaks if it goes down.

| **Dependency**                  | **Cost** | **Failure impact**                         | **Fallback**                                                                  |
|---------------------------------|----------|--------------------------------------------|-------------------------------------------------------------------------------|
| Maryland SBE website            | Free     | No new candidate data                      | Retry next scheduled run; raw HTML archive available                          |
| Maryland ArcGIS REST            | Free     | No boundary updates                        | Data already in DB; only matters if boundaries change                         |
| U.S. Census Geocoder            | Free     | Ballot lookup broken                       | Fall back to Nominatim (OpenStreetMap) — also free                            |
| Supabase (free tier)            | Free     | Site partly broken                         | Static pages still serve; only ballot lookup fails                            |
| Vercel (free tier)              | Free     | Site down                                  | Rebuild deploys to CDN edge; 99.99% uptime SLA on free tier                   |
| Google AI Studio (Gemini Flash) | Free     | No new enrichment                          | Existing cached summaries still display; pipeline queues and retries next day |
| GitHub Actions                  | Free     | No pipeline runs                           | Manual script execution from local machine as backup                          |
| Twitter API free tier           | Free     | Thin-candidate social inference incomplete | Fall back to Facebook + LinkedIn only                                         |
| Playwright / Firecrawl free     | Free     | Website scraping broken                    | Raw text from last successful scrape persists; voters see cached content      |

## 10. Environment Setup & Secrets
All secrets are stored as GitHub Actions secrets and in a local .env file that is never committed to the repository.

| **Secret**                | **Where used**                  | **How to obtain**                                                                 |
|---------------------------|---------------------------------|-----------------------------------------------------------------------------------|
| SUPABASE_URL              | All scripts + Next.js           | Supabase project settings → API                                                   |
| SUPABASE_SERVICE_ROLE_KEY | Pipeline scripts (write access) | Supabase project settings → API → service_role key                                |
| SUPABASE_ANON_KEY         | Next.js frontend (read-only)    | Supabase project settings → API → anon key                                        |
| GOOGLE_AI_STUDIO_API_KEY  | enrich_candidates.py            | aistudio.google.com → Get API key (free, no billing required)                     |
| TWITTER_BEARER_TOKEN      | scrape_social_media.py          | developer.twitter.com → free tier app                                             |
| VERCEL_DEPLOY_HOOK_URL    | trigger_build.py                | Vercel project → Settings → Git → Deploy hooks                                    |
| ALERT_EMAIL_PASSWORD      | detect_withdrawals.py           | Gmail app password (not your main password) — Settings → Security → App passwords |

## 11. Multi-Cycle Lifecycle (2026, 2028, 2030, and Beyond)
### 11.1 Scale reality check
The site does not get meaningfully bigger or slower over time. Here is why:

| **Concern**        | **Reality**                                                                                                                                                                                                                             |
|--------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Database bloat     | ~700 candidates × 10 cycles = 7,000 rows. Postgres handles tens of millions rows comfortably. Your entire multi-decade dataset will likely fit under 200MB — well within Supabase's free tier forever.                                  |
| Site getting slow  | SSG means each page is a static HTML file on a CDN. A 2026 page does not slow down a 2034 page. They are independent files. The site does not get heavier.                                                                              |
| Build time growing | By 2032 you may have ~4,000 candidate pages across cycles. Incremental Static Regeneration (ISR) means Next.js only rebuilds pages that actually changed — not the full archive every time. Set this up from day one (one config line). |
| URL collisions     | A different Jane Smith will run in 2028. Cycle must be in the slug from day one: /candidates/jane-smith-pg-council-d4-2026-primary. Never /candidates/jane-smith.                                                                       |
| Storage costs      | Supabase free tier: 500MB. Vercel free tier: 100GB bandwidth. Neither limit is threatened by a decade of election data.                                                                                                                 |

### 11.2 Schema additions for cycle management
One new table and one foreign key added to contests. Everything else in the existing schema is unchanged.

**cycles (new table)**

| **Column**           | **Type**             | **Notes**                                                       |
|----------------------|----------------------|-----------------------------------------------------------------|
| id                   | uuid PK              |                                                                 |
| year                 | integer UNIQUE       | 2026, 2028, 2030, 2032 …                                        |
| label                | text                 | e.g. '2026 Election Cycle'                                      |
| status               | text                 | 'upcoming' \| 'active' \| 'closed'                              |
| filing_opens         | date                 | When the SBE filing period opens — activate 6-hour scrape cron  |
| filing_closes        | date                 | When filing closes — drop back to weekly cron                   |
| primary_date         | date                 |                                                                 |
| general_date         | date                 |                                                                 |
| results_certified_at | timestamptz nullable | Set when official results are certified; triggers cycle closure |
| archived_at          | timestamptz nullable | Set when cycle transitions to archive-only display mode         |

**contests table — add cycle_id**

| **Column** | **Type**         | **Notes**                                                 |
|------------|------------------|-----------------------------------------------------------|
| cycle_id   | uuid FK → cycles | Add this column to the existing contests table. Index it. |

> *The ballot lookup query filters by cycle status = 'active' so voters always see the current cycle's races, not historical ones. Archive pages remain accessible via direct URL and search.*

### 11.3 Election results — schema additions
Maryland publishes official results as precinct-level CSV files after each election. Two tables handle this: a summary (who won, total votes) and optionally a precinct breakdown for future results dashboards.

**contest_results (new table)**

| **Column**          | **Type**             | **Notes**                                                       |
|---------------------|----------------------|-----------------------------------------------------------------|
| id                  | uuid PK              |                                                                 |
| contest_id          | uuid FK → contests   |                                                                 |
| candidate_id        | uuid FK → candidates |                                                                 |
| total_votes         | integer              | Certified vote total for this candidate in this contest         |
| vote_percentage     | numeric(5,2)         | Computed: total_votes / contest total votes × 100               |
| result              | text                 | 'won' \| 'lost' \| 'runoff' \| 'pending'                        |
| is_incumbent_winner | boolean              | True if winner was an incumbent — useful for historical display |
| source_url          | text                 | Link to the official MD SBE results CSV this data came from     |
| certified_at        | timestamptz          | Date results were officially certified                          |

**precinct_results (new table — Phase 3)**

Precinct-level breakdown for results dashboards. Marked Phase 3 because it requires building a results visualization UI. The data is cheap to ingest now if you want to future-proof.

| **Column**   | **Type**             | **Notes**                                      |
|--------------|----------------------|------------------------------------------------|
| contest_id   | uuid FK → contests   | Composite PK with precinct_id + candidate_id   |
| precinct_id  | uuid FK → precincts  |                                                |
| candidate_id | uuid FK → candidates |                                                |
| votes        | integer              | Vote count for this candidate in this precinct |

### 11.4 Results ingestion — algorithm
Maryland SBE publishes election night results (unofficial) and certified results (official, ~4 weeks after election day) as CSV files. The ingestion script handles both, clearly labeling which is which.

> *ALGORITHM: ingest_results.py*
>
> 1\. Triggered manually after election night and again after
>
> certification. Not a scheduled job — you run it deliberately.
>
> 2\. Download the MD SBE results CSV for the relevant cycle.
>
> File structure: contest_name, candidate_name, precinct,
>
> party, votes, is_certified
>
> 3\. For each row, match candidate by:
>
> sbe_candidate_id (primary) OR
>
> full_name + contest slug (fallback)
>
> Log any rows that cannot be matched for manual review.
>
> 4\. Aggregate total_votes per candidate per contest.
>
> Compute vote_percentage per candidate.
>
> Determine result: highest vote-getter(s) up to seats_available
>
> = 'won'; all others = 'lost'.
>
> 5\. Upsert into contest_results.
>
> Set result = 'pending' on election night (unofficial).
>
> Update result to 'won'/'lost' after certification.
>
> Set source_url to the official CSV download link.
>
> 6\. Update candidates.filing_status for winners:
>
> Add 'elected' as a valid status alongside 'Active'/'Withdrawn'
>
> 7\. Trigger site rebuild — candidate and race pages
>
> now show results.

### 11.5 What the site looks like in each phase
| **Phase**                    | **Site behavior**                                                                                                                                                                                                          |
|------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Pre-filing (off-season)      | Current cycle shows 'Filing opens \[date\]'. Previous cycle results are the main content. Ballot lookup returns the most recent completed election for reference. Pipeline is inactive.                                    |
| Filing period open           | Candidate pages appear as candidates file. Enrichment pipeline running. 6-hour SBE scrape active. Ballot lookup shows upcoming contests.                                                                                   |
| Filing closed → election day | Candidate data is stable. Weekly refresh only. Site is in its most useful voter-research state. Ballot lookup fully functional.                                                                                            |
| Election night               | ingest_results.py run manually. Candidate pages show unofficial results labeled clearly as 'Unofficial — results pending certification'. Race pages show running totals.                                                   |
| Post-certification           | ingest_results.py run again with certified=true. Results labels update. Winners display 'Elected' badge. Cycle status flips to 'closed'.                                                                                   |
| Archive (between cycles)     | All 2026 pages remain fully accessible. URLs are permanent. Search surfaces historical candidates. Ballot lookup defaults to most recent cycle. New cycle row added to cycles table when SBE publishes 2028 race listings. |

### 11.6 Starting a new cycle — checklist
This is the complete list of actions needed to open a new election cycle. No code changes required — only data and config.

- INSERT a new row into the cycles table with the correct filing_opens, filing_closes, primary_date, and general_date for the new year.

- Set the new cycle status to 'upcoming'. The existing cycle stays 'closed'. Only one cycle is ever 'active' at a time.

- When filing opens: run ingest_contests.py against the new SBE race listing — new contest rows are created with the new cycle_id. Activate the 6-hour GitHub Actions cron.

- Run ingest_sbe_candidates.py — new candidates get new rows. Existing candidates who run again get new rows with the new cycle_id (their 2026 row is untouched).

- The enrichment pipeline runs exactly as before. All the same scripts, same logic, new data.

- Flip the new cycle status to 'active'. The ballot lookup and homepage now surface the new cycle automatically — no frontend code changes needed.

- The previous cycle's pages remain live at their permanent URLs. Nothing is deleted or archived — it just stops being the 'active' cycle.

> *A candidate who ran in 2026, 2028, and 2030 has three separate candidate rows with three separate slugs, three separate enrichment records, and three separate result records. Their history is fully preserved and linkable across cycles.*

### 11.7 ISR configuration for long-term build performance
Incremental Static Regeneration ensures that as the archive grows across cycles, only changed pages are rebuilt. Add this to every getStaticProps function from day one:

> // In getStaticProps for /candidates/\[slug\], /races/\[slug\], etc.
>
> return {
>
> props: { ... },
>
> revalidate: 3600 // rebuild this page at most once per hour
>
> // only if it has actually been requested
>
> }
>
> // For closed-cycle archive pages (2026 content after Nov 2026):
>
> // Set revalidate: 86400 (once per day) or false (never rebuild)
>
> // Archive pages do not change — no reason to rebuild them.
>
> // Determine in getStaticProps:
>
> const isClosed = cycle.status === 'closed'
>
> return {
>
> props: { ... },
>
> revalidate: isClosed ? false : 3600
>
> }

With this in place, a full rebuild in 2032 with 4,000+ pages takes the same time as a 2026 rebuild with 700 pages — because Vercel only rebuilds the pages that have actually been requested and have stale data.

*— End of Implementation Strategy —*
