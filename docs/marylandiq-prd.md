# MarylandIQ

**Product Requirements Document**

marylandiq.com — MVP Phase 1: County-Level Races (2026 Election Cycle)

**Version:** 0.2 — Reconciled with Implementation Strategy

**Status:** For Review

**Date:** April 2026

## 1. Overview
Maryland voters in local races — school board, county council, sheriff, register of wills — have no single reliable place to research their ballot. Ballotpedia covers statewide races adequately but consistently leaves local contests either blank or with minimal information. The Maryland State Board of Elections publishes official candidate data but in formats built for compliance, not voter usability.

MarylandIQ fills that gap. It scrapes and aggregates public data from official sources, candidate websites, and social media, then uses an LLM layer to enrich thin candidate profiles and surface what voters actually need: plain-English summaries, issue tags, side-by-side comparisons, and a dead-simple address-based ballot lookup.

The guiding constraint is near-zero cost. Every data source used in the MVP is free and publicly available. Hosting runs on free-tier infrastructure. The LLM layer runs against a local LM Studio server by default, with hosted backends available as fallback options when needed.

## 2. Problem Statement
### 2.1 The local information gap
The problem is not a lack of data — it is a lack of assembly. Maryland's State Board of Elections publishes candidate filings as scrapeable HTML. County boards publish PDFs. Election results ship as CSV files. Precinct boundary data sits on a public ArcGIS REST server. None of it is connected or usable by a typical voter.

The result: a voter researching their county council race finds a partially-filled Ballotpedia stub, a wall-of-text PDF from the county board, and a blank campaign website. Or nothing at all.

### 2.2 The thin candidate problem
Local races — town council, school board, minor county offices — frequently feature candidates who filed with the state, have no campaign website, and have never been covered by local news. Existing platforms leave these pages empty. MarylandIQ treats the thin candidate problem as the core design challenge, not an edge case.

When a candidate has minimal official presence, the pipeline uses a three-tier approach: first, follow any social links already present in the SBE filing or the candidate's own website HTML (zero ambiguity). Second, if none found, run a structured search using name + office + jurisdiction — never name alone — to locate public campaign pages. Third, every profile found via search is validated by the LLM with a binary YES/NO/UNCERTAIN check before anything is stored. UNCERTAIN defaults to null. A false match is worse than a blank field, and 'no verified social presence found' is a legitimate and honest state. Every inference is clearly labeled as such.

### 2.3 Municipal elections are out of scope for MVP
Maryland has 157 municipalities running their own off-cycle elections, many of which do not share future election dates with the State Board. Building a complete municipal ingestion subsystem is a Phase 2 problem. The MVP targets county-level races for the 2026 primary and general elections only.

## 3. Goals & Success Metrics
| **Goal**          | **Metric**                                                    | **Target**   |
|-------------------|---------------------------------------------------------------|--------------|
| Voter utility     | % of ballot-lookup sessions that click into ≥1 candidate page | ≥ 35%        |
| Data completeness | % of county-level candidates with ≥3 data fields populated    | ≥ 90%        |
| Data freshness    | Nightly pipeline success rate                                 | ≥ 99%        |
| Trust accuracy    | % of candidate pages receiving correction reports             | \< 1%        |
| Cost              | Monthly infrastructure + API spend                            | \< \$20/mo   |
| Performance       | Ballot results page load on mobile (p50)                      | \< 2 seconds |

## 4. Feature Specifications
### 4.1 Address-Based Ballot Lookup
**PRIORITY: MUST HAVE — THIS IS THE FRONT DOOR**

Voters enter their address and receive the complete list of races on their ballot with links to each candidate and race page. The experience must be fast, mobile-first, and require no account creation.

**How it works**

- Voter enters a Maryland address.

- The address is geocoded using the U.S. Census Bureau Geocoder API (free, no key required).

- The returned lat/lng is joined against Maryland precinct boundary polygons hosted on a public ArcGIS REST FeatureServer (free).

- The matched precinct is cross-referenced against a local database of contest-to-precinct mappings, derived from Maryland SBE's published race data.

- The voter sees their personalized ballot with all active races.

No voter registration files are accessed. Maryland law restricts VR list use to specific electoral purposes with fees and deadlines. The geocode + boundary approach is legally clean and technically simpler.

**UX requirements**

- Address autocomplete on the input field (use free Nominatim/OpenStreetMap or the Census API's address suggest endpoint).

- "Why am I seeing this race?" expandable explainer on each contest showing the derived district and linking to the official boundary source.

- Election-context switcher: 2026 Primary / 2026 General (pre-populated; user can toggle).

- No address is stored. Processing is ephemeral; only the precinct ID is held in session.

### 4.2 Candidate Pages
**PRIORITY: MUST HAVE — CORE PRODUCT**

Each candidate gets a structured page unifying all available information from official filings, their own campaign presence, and AI-enriched data from public sources. Every data field carries a trust label.

**Sections on a candidate page**

- **Status, office, district, party (where applicable), filing date, and SBE candidate ID. Source: Maryland SBE scrape. Label: Official source.:** Official Filing Facts

- **Link to campaign website. Extracted key content (issues, About text) with link back to source. Social media profile links. Label: Candidate website / Candidate social.:** Campaign Presence

- **A 2–4 sentence plain-English summary of the candidate's apparent priorities, derived from scraped content. Displayed under a clearly styled "AI-generated summary — review sources" header. Label: Machine-assisted.:** AI-Enriched Summary

- **Displayed when official + website content is below a completeness threshold. Shows extracted issue mentions, affiliations, and tone from public social profiles. Each inference links to the source post or page. Label: Inferred from public social media.:** Inferred from Social Media (thin candidates only)

- **Tags (e.g., Education, Housing, Public Safety) derived only from explicit candidate statements, not free-form generation. Sourced and labeled.:** Issue Tags

- **Deep-links to the Maryland SBE campaign finance database entry for this candidate. Link out only — no mirroring of restricted content.:** Finance & Disclosure Links

- **Link to the race comparison view.:** Compare in this race

- **Simple email-based correction form (see Section 4.6).:** Report an error

**Trust label design**

Trust labels are small colored badges on each data section, not footnotes. Four types:

- Official source — state/county board, official GIS layers, published results files.

- Candidate-submitted — campaign site, social profiles directly managed by the candidate.

- Inferred from public social media — extracted by AI from public profiles, clearly differentiated.

- Machine-assisted summary — AI-generated text explicitly labeled, always linked to evidence.

### 4.3 Race Pages & Side-by-Side Comparison
**PRIORITY: MUST HAVE**

Each contest (e.g., Prince George's County Council District 4) has its own page listing all candidates, plus a structured comparison view.

**Race page**

- Office name, district, election date, number of seats.

- Plain-English explainer of what this office does (pre-generated once per office type, cached statically — see Section 4.5).

- Candidate cards with summary info and link to full candidate page.

**Comparison view**

Side-by-side table of candidates with issue rows. Each cell either shows a sourced stance, "No public information found" (labeled), or a gap indicator. Free-form generation is not used in comparison cells — only evidence-linked content drawn from scraped sources appears here. "No public information found" is itself informative data and is displayed neutrally.

### 4.4 Ballot Measure Pages
**PRIORITY: MUST HAVE FOR ANY JURISDICTION WITH MEASURES ON THE 2026 BALLOT**

- Official measure title and text (sourced from county/state board).

- Plain-English summary: generated once by the LLM at ingest time, cached. Label: Machine-assisted summary.

- Official pro/con statements (when published by the jurisdiction).

- Link to the official source document.

Measures are relatively static once set. The LLM cost here is minimal: one call per measure, cached forever until the official text changes.

### 4.5 Office Explainers
**PRIORITY: SHOULD HAVE — HIGH VALUE, NEAR-ZERO COST**

Short explainer pages (and embedded cards) for each office type on the 2026 ballot: County Executive, County Council Member, Sheriff, State's Attorney, Register of Wills, Clerk of the Circuit Court, Board of Education Member, Orphans' Court Judge.

Each explainer is generated once via LLM using the official office description from Maryland SBE's "Offices up for Election" list, then cached statically. Cost: one LLM call per office type, ever. These explainers embed on the relevant race and candidate pages.

### 4.6 Corrections Workflow
**PRIORITY: MUST HAVE — TRUST DEPENDS ON IT**

- "Report an issue" link on every candidate and race page.

- Form captures: reporter's email (optional), page URL, issue type (wrong info / outdated / missing / other), and free-text description.

- Submissions go to a shared email inbox for MVP. A ticketing system with SLAs and public change logs is Phase 2.

- Corrections are reviewed manually and applied via re-scrape or data override.

- Resolved corrections add a "Last updated" timestamp to the affected page section.

## 5. AI & LLM Layer
### 5.1 What the LLM does
| **Use case**                  | **Input**                        | **Caching strategy**                        |
|-------------------------------|----------------------------------|---------------------------------------------|
| Candidate summary             | Scraped website + social content | Cached on ingest; refresh on content change |
| Thin candidate inference      | Public social media text         | Cached on ingest; re-run weekly             |
| Ballot measure plain-language | Official measure text            | Cached forever; re-run if text changes      |
| Office explainers             | Official office description      | Cached forever; one-time generation         |
| Issue tag extraction          | Candidate statements             | Cached on ingest                            |

### 5.2 Model selection & cost
Use LM Studio locally as the default inference backend for candidate enrichment and thin-candidate social validation. Keep Gemini via Google AI Studio or OpenRouter available as fallbacks if the local server is unavailable or a particular model performs better for a task.

Total projected monthly LLM cost: \$0. The Google AI Pro subscription already in place (\$20/month) provides a \$10/month Google Cloud credit as a backstop if scale ever exceeds the free tier — but this is not expected to be needed at MVP.

### 5.3 What the LLM does NOT do
- Generate any content displayed in comparison cells without a sourced evidence link.

- Produce candidate positions not grounded in something they actually said or published.

- Make any claims about a candidate without labeling them as inferred.

- Replace official data with generated text.

The LLM is an enrichment and accessibility layer, not the source of record. Official data always takes precedence.

### 5.4 Social media inference pipeline
Triggered when a candidate's completeness score (official fields + website content) falls below a threshold. The pipeline:

1.  Searches the candidate's name + jurisdiction across public Facebook pages, X/Twitter (free tier search), and LinkedIn public profiles.

2.  Collects publicly visible posts, bios, and about text.

3.  Feeds collected text to the LLM with a strict extraction prompt: extract issue mentions, affiliations, tone signals. Do not fabricate. If insufficient content, return null.

4.  Displays extracted content in a clearly labeled section with source links. If null, section is hidden.

## 6. Data Sources & Pipeline
### 6.1 Official sources (all free)
| **Source**                             | **What we get**                                                                                      | **Method**                    |
|----------------------------------------|------------------------------------------------------------------------------------------------------|-------------------------------|
| Maryland SBE candidate list            | Candidate name, office, district, party, status, filing date, committee ID, sometimes website/social | Scraped HTML                  |
| Maryland SBE election results          | Past results CSV files by precinct                                                                   | Direct CSV download           |
| ArcGIS REST FeatureServer (MD)         | Precinct boundary polygons as GeoJSON                                                                | REST API query — free, no key |
| U.S. Census Bureau Geocoder            | Lat/lng from address                                                                                 | REST API — free, no key       |
| County board of elections sites        | Supplemental candidate PDFs, district maps                                                           | Scraped HTML + PDF extraction |
| Maryland SBE 'Offices up for Election' | Complete list of 2026 races and office descriptions                                                  | Scraped HTML                  |

### 6.2 Candidate-enrichment sources
| **Source**               | **What we get**                           | **Constraints**                                                           |
|--------------------------|-------------------------------------------|---------------------------------------------------------------------------|
| Campaign websites        | Platform text, About content, issue pages | Playwright scrape; respect robots.txt; Firecrawl free tier as backup      |
| Public Facebook pages    | Posts, bio, about section                 | Public page scrape only; no login required                                |
| X / Twitter              | Public tweets and bio                     | Free API tier (500 reads/month); prioritize candidates with thin profiles |
| LinkedIn public profiles | Headline, about, experience               | Profile-level scrape only; no wall data                                   |
| Local news (optional)    | Coverage citations                        | Search API or targeted scrape; link-out only for MVP                      |

### 6.3 Pipeline architecture
All data ingestion runs as GitHub Actions workflows (free up to 2,000 min/month). The schedule is event-driven and matched to the Maryland election calendar — not a nightly cron. Over-refreshing wastes resources; candidate data only meaningfully changes during three windows per cycle.

- Filing period (every 6 hours): Maryland SBE candidate list scraped for new filings and status changes. Triggers website scrape and enrichment for new candidates.

- Filing closed → election week (weekly): Light refresh checking for withdrawals only. Withdrawal detected → alert fires within minutes.

- Election day (every 2 hours): Results ingestion from MD SBE CSV files.

- Off-season: Pipeline inactive. No scheduled runs.

Website scraping uses a two-path strategy: fast path (requests + BeautifulSoup, ~1–2s) attempted first; Playwright fallback only for JavaScript-rendered sites (~8–12s). Five concurrent workers keep a full 500-candidate run under 15 minutes. Social media discovery uses a three-tier approach: follow official links first, structured search second (name + office + jurisdiction — never name alone), LLM validation gate third before any content is stored.

- Change detection: SBE candidate records are diffed on every run by sbe_candidate_id. New candidates queue for enrichment; withdrawals trigger an immediate alert email.

- Build trigger: Any pipeline run that modifies data calls a Vercel deploy webhook to rebuild static pages. Incremental Static Regeneration (ISR) means only changed pages rebuild — archive pages from prior cycles are never rebuilt.

## 7. Hosting & Infrastructure
| **Layer**      | **Service**                                   | **Cost**                                                                                      |
|----------------|-----------------------------------------------|-----------------------------------------------------------------------------------------------|
| Frontend       | Vercel (free tier)                            | Free — 100GB bandwidth, unlimited deployments, ISR supported                                  |
| Database       | Supabase (free tier)                          | Free — 500MB Postgres + PostGIS (required for boundary joins), 2GB bandwidth                  |
| Scheduled jobs | GitHub Actions                                | Free — up to 2,000 min/month on public repo                                                   |
| Web scraping   | Playwright + requests/BeautifulSoup           | Free — fast path first, Playwright fallback; 5 concurrent workers; runs inside GitHub Actions |
| LLM            | LM Studio local server by default             | Free if run locally; optional Gemini/OpenRouter fallback                                      |
| Search         | Supabase built-in full-text search (Postgres) | Free — no Algolia or Elasticsearch needed for MVP                                             |
| Analytics      | Plausible or Umami self-hosted                | Free — privacy-preserving, no raw address storage                                             |

Total projected monthly cost at MVP scale: \$0–5. Every infrastructure service runs on a free tier. LLM usage is covered by the Google AI Studio free tier. The only potential cost is Vercel bandwidth if traffic significantly exceeds expectations.

## 8. Out of Scope for MVP
| **Feature**                   | **Rationale for deferral**                                                                          |
|-------------------------------|-----------------------------------------------------------------------------------------------------|
| Municipal elections           | 157 municipalities; many off-cycle; requires its own ingestion subsystem. Phase 2.                  |
| Campaign finance detail       | Deep-link to MD SBE finance DB. Mirroring restricted content adds legal and maintenance complexity. |
| Financial disclosure display  | State system requires PII to access; link-out only per state guidance.                              |
| Results dashboards            | Official CSVs are available; building the display layer is a post-launch feature.                   |
| Public API / data licensing   | Phase 3 — monetization consideration only after core product is validated.                          |
| Editorial corrections queue   | Simple email form at MVP. SLA-backed ticketing with public change logs is Phase 2.                  |
| Voter registration lookup     | Legal restrictions on MD voter file use. Not needed; geocode + boundary approach works.             |
| User accounts / saved ballots | Adds complexity and privacy surface area. Deferred to Phase 2.                                      |

## 9. Phased Roadmap
**Phase 1 — MVP (Target: live before 2026 primary filing closes)**

- Address-based ballot lookup (geocode + ArcGIS boundary join).

- Candidate pages with official data + AI-enriched summaries + trust labels.

- Race pages with office explainers and comparison view.

- Ballot measure pages with plain-language summaries.

- Three-tier social media inference pipeline for thin candidates with LLM validation gate.

- Event-driven data refresh via GitHub Actions (6-hour during filing period, weekly otherwise, off in dead periods).

- Email-based corrections form.

- County-level races only — all 24 Maryland county jurisdictions.

**Phase 2 — Build-Out (Post-launch, pre-2026 general)**

- Election results ingestion: ingest MD SBE result CSVs after primary and general; display winner badges and vote totals on candidate and race pages. Unofficial results on election night, certified results ~4 weeks later.

- Cycle closure: flip 2026 cycle to 'closed' status; archive pages remain live at permanent URLs; ballot lookup defaults to most recently closed cycle for reference.

- Structured corrections queue with internal review and public change log.

- Municipal elections module — start with Prince George's County as a template, then expand.

- User-facing "save my ballot" feature.

- Local news citation layer — link to relevant coverage on candidate and race pages.

**Phase 3 — Ongoing cycles (2028, 2030, 2032, and beyond)**

Each new election cycle requires no code changes — only data and configuration. MarylandIQ is designed to run indefinitely across cycles with flat infrastructure costs.

- Open new cycle: INSERT a row into the cycles table with the new year's filing and election dates. Flip status to 'active' when filing opens. The frontend surfaces the new cycle automatically.

- All pipeline scripts run unchanged against the new cycle's SBE data. New candidate rows are created with the new cycle_id; prior cycle records are untouched and remain live at their permanent URLs.

- A candidate who runs in multiple cycles has separate rows per cycle — full history preserved and linkable.

- Statewide municipal election coverage (157 municipalities).

- Precinct-level results dashboards using MD SBE CSV breakdowns.

- Public API for Maryland election data.

- Data licensing exploration (revenue stream).

## 10. Non-Functional Requirements
**Performance**

- Ballot lookup result page: \< 2 seconds on mobile (p50).

- Candidate and race pages: statically generated (SSG) at build time — no database query at runtime, sub-second load from CDN edge.

- Incremental Static Regeneration (ISR): only pages with changed data rebuild on each deploy. Archive pages from prior cycles set revalidate: false — never rebuilt once a cycle closes.

- Canonical URLs for all offices, races, and candidates with "last updated" timestamps. Cycle is always part of the slug (e.g. /candidates/jane-smith-pg-council-d4-2026-primary) to prevent collisions across election years.

**Accessibility**

- WCAG 2.1 AA compliance. Maryland's own election agency references COMAR nonvisual accessibility requirements; we treat this as a hard requirement, not nice-to-have.

- No critical information behind PDF-only paths.

- Screen-reader-friendly trust label markup.

**Privacy**

- No raw addresses stored. Geocoding is ephemeral; only the derived precinct ID is held in session.

- Privacy-preserving analytics (Plausible or Umami). No third-party ad trackers.

- Candidate personal contact details (personal phone, personal email) displayed behind a "show" interaction where present in filings; campaign contact channels shown by default.

**Trust & Accuracy**

- Every data field has a visible trust label.

- "Last updated" timestamp on every candidate page.

- AI-generated text is never displayed without a label and a link to its source evidence.

- "No public information found" is a valid and displayed state — never hidden or glossed over.

## 11. Open Questions
- X/Twitter API access: The free tier (500 reads/month) is a binding constraint for social inference. Given the three-tier approach prioritizes official links and Facebook first, Twitter falls to last resort — but evaluate whether the 500-read ceiling is sufficient or whether to disable Twitter lookup entirely for MVP and rely on Facebook + LinkedIn only.

- Corrections accountability: Should correctors be required to provide an email address? Requiring contact info reduces spam but may reduce legitimate reports. Recommendation: optional email for MVP with a CAPTCHA on the form.

- Election night staffing: Results ingestion on election night requires a manual trigger. Decide in advance who runs ingest_results.py and at what time — this is a human ops question, not a technical one.

- ArcGIS district boundary layers: County-wide races map cleanly to all precincts in a jurisdiction. District races (e.g. County Council District 4) require a separate district boundary layer on ArcGIS. Confirm these layers exist and are publicly accessible for all 24 Maryland jurisdictions before committing to the precinct_contests mapping approach.

*— End of Document —*
