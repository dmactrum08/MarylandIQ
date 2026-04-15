# MarylandIQ — Frontend Architecture

**Version:** 1.0
**Stack:** Next.js 15 (App Router) · Tailwind CSS · TypeScript · Vercel
**Status:** Planning

---

## 1. Design Philosophy

MarylandIQ is built for voters first. Two types of voters arrive:

- **Lookup-intent users** — they have an election coming up and want to know what's on their specific ballot.
- **Research-intent users** — they already know a candidate's name, a county, or a race, and want to find information directly.

The homepage must serve both equally. The ballot lookup is the fastest path to a personalized result, but it cannot be the only entry point. A voter who Googles "Marcus Brown Prince George's County" must be able to land on a useful page without running the address flow. County index pages, candidate search, and direct race pages all serve this second path.

The guiding principle is: **static over dynamic everywhere possible**. Only the ballot lookup requires a runtime database query. Every other page is pre-rendered at build time and served from the Vercel CDN edge.

---

## 2. Full Sitemap

### 2.1 Public routes

| Route | Page Name | Rendering | Data Source |
|---|---|---|---|
| `/` | Homepage | Static (SSG) | None — pure UI |
| `/ballot` | Ballot Results | Server Component (runtime) | Supabase — precinct lookup |
| `/candidates` | Candidate Browser | Static (SSG, regenerated on build) | Supabase at build time |
| `/candidates/[slug]` | Candidate Profile | ISR (revalidate on data change) | Supabase at build time |
| `/races` | All Races | Static (SSG) | Supabase at build time |
| `/races/[slug]` | Race / Contest Page | ISR | Supabase at build time |
| `/races/[slug]/compare` | Side-by-Side Comparison | ISR | Supabase at build time |
| `/measures/[slug]` | Ballot Measure | ISR | Supabase at build time |
| `/offices/[slug]` | Office Explainer | Static (SSG) | Supabase at build time |
| `/counties` | County Index | Static (SSG) | Static — 24 MD jurisdictions |
| `/counties/[slug]` | County Detail | Static (SSG) | Supabase at build time |
| `/about` | About / Methodology | Static (SSG) | Hardcoded content |
| `/privacy` | Privacy Policy | Static (SSG) | `docs/PRIVACY.md` content |
| `/terms` | Terms of Service | Static (SSG) | `docs/TERMS.md` content |

### 2.2 API routes (runtime, server-side only)

| Route | Purpose |
|---|---|
| `/api/ballot-lookup` | Accepts geocoded lat/lng; queries Supabase for precinct → races |
| `/api/report` | Accepts correction form submission; writes to `corrections` table |
| `/api/search` | Full-text candidate + race search via Supabase FTS |

---

## 3. Page Specifications

### 3.1 Homepage `/`

**Purpose:** Serve both lookup-intent and research-intent users from a single landing page. This is not a ballot-lookup-only page — it is a civic information hub that happens to have ballot lookup as its fastest path.

**Rendering:** Static (SSG) — no data fetching needed on this page.

**Sections (top to bottom):**

1. **Hero** — Site name, tagline, trust statement ("official sources, labeled everywhere").
2. **Address Lookup** — The primary CTA. Address input with autocomplete. Submits to `/ballot`. Does not store the address.
3. **Divider / "Or explore directly"** — Clear visual break separating lookup from browse.
4. **Candidate Search Bar** — Full-text search input that calls `/api/search` and routes to `/candidates?q=...`. Prominent enough to be an equal alternative to address lookup.
5. **Browse by County** — Grid or list of all 24 Maryland county jurisdictions, each linking to `/counties/[slug]`. Lets research-intent users self-select their jurisdiction.
6. **Browse by Office Type** — Links to all major office types (County Executive, School Board, Sheriff, etc.) pointing to `/offices/[slug]`. Helps users who know what office they're interested in.
7. **How It Works** — Three-step explainer (Enter address or search → See your ballot → Read candidate profiles). Brief, mobile-friendly.
8. **Trust Statement** — Short paragraph explaining data sourcing philosophy and the trust label system.
9. **Footer** — Nav links, Privacy, Terms, Report an Issue, About.

**What this page does NOT do:**
- Require an address to see any content.
- Require an account.
- Store any user data.

---

### 3.2 Ballot Results `/ballot`

**Purpose:** Show a voter the complete list of races on their specific ballot after address lookup.

**Rendering:** Server Component (runtime). This is the only page that requires a live database query. The query is fast (two-step PostGIS lookup, indexed) and result is not cacheable per-user, so ISR does not apply.

**Query flow:**
1. Address is geocoded client-side via Census Geocoder API before form submission.
2. Lat/lng is posted to `/api/ballot-lookup`.
3. Supabase runs ST_Within() to find the precinct, then returns all contests for that precinct.
4. Page renders the contest list.

**Sections:**
- Detected precinct and jurisdiction (with "Why am I seeing this?" expandable).
- Election-context toggle: 2026 Primary / 2026 General.
- List of races on the ballot, grouped by office type. Each race card links to `/races/[slug]`.
- Each race card shows candidate count and a "See candidates" CTA.
- If no races found (address outside Maryland, or lookup fails): clear error state with fallback to `/counties`.

**Error states:**
- Address not in Maryland → "We only cover Maryland elections. Try browsing by county."
- Geocode API failure → "We couldn't geocode that address. Try a different format or browse by county."
- No races found for precinct → "No active races found for this address in the current cycle."

---

### 3.3 Candidate Browser `/candidates`

**Purpose:** Let research-intent users search and filter across all candidates in the database.

**Rendering:** Static shell (SSG) with client-side search via `/api/search`. A server-rendered list of all candidates is generated at build time as a fallback (no JS required for basic browsing).

**Filters:**
- Full-text search by name.
- Filter by county/jurisdiction.
- Filter by office type.
- Filter by party.
- Filter by election type (primary / general).

**Candidate cards show:** Name, office, jurisdiction, party, filing status (active / withdrawn), link to full profile.

**Sorting:** Default alphabetical by last name. Results reorder on search.

---

### 3.4 Candidate Profile `/candidates/[slug]`

**Purpose:** The core information page for a single candidate. All available data unified in one place with trust labels on every section.

**Rendering:** ISR — pages are generated at build time; rebuild is triggered by the data pipeline webhook whenever a candidate's data changes (`trigger_build.py`). Withdrawn candidates keep their pages live but gain a prominent "WITHDRAWN" status banner.

**Slug format:** `[first-last]-[jurisdiction-abbrev]-[office-abbrev]-[year]-[election-type]`
Example: `jane-smith-pg-council-d4-2026-primary`

**Sections:**

| Section | Trust Label | Shown When |
|---|---|---|
| Official Filing Facts | Official source | Always |
| Campaign Presence (website, social links) | Candidate-submitted | When URL(s) exist |
| AI-Enriched Summary | Machine-assisted summary | When `ai_summary` is populated |
| Inferred from Social Media | Inferred from public social media | When `inferred_from_social = true` and `completeness_score < threshold` |
| Issue Tags | Sourced (per-tag) | When `issue_tags` array is non-empty |
| Finance & Disclosure Links | Official source | Always (deep-link to MD SBE finance DB) |
| Compare in this race | — | Always (links to `/races/[slug]/compare`) |
| Report an Error | — | Always |
| Last Updated | — | Always (timestamp in footer of page) |

**Withdrawn candidate handling:** Page renders normally with a red "WITHDRAWN — [date detected]" banner at the top. All data remains visible for research purposes.

**"No information found" state:** If `completeness_score` is very low and no enrichment data exists, the page still renders with official filing facts and a clear statement: "No additional public information found for this candidate." This is not hidden.

---

### 3.5 Race / Contest Page `/races/[slug]`

**Purpose:** Show all candidates in a specific contest, with an office explainer and a link to the comparison view.

**Rendering:** ISR.

**Slug format:** `[jurisdiction-abbrev]-[office-abbrev]-[district]-[year]-[election-type]`
Example: `pg-county-council-district-4-2026-primary`

**Sections:**
- Office name, jurisdiction, district, election date, seats available.
- Office explainer card (embedded from `offices` table — see 3.7).
- "Why am I seeing this district?" expandable (shows boundary source link).
- Candidate cards — name, party, filing status, AI summary snippet, issue tags, link to full profile.
- "Compare candidates side by side" CTA → `/races/[slug]/compare`.
- Report an issue link.

---

### 3.6 Side-by-Side Comparison `/races/[slug]/compare`

**Purpose:** Structured comparison of all candidates in a race across issue dimensions.

**Rendering:** ISR (same data as race page; separate route for clean URL sharing).

**Layout:** Table with candidates as columns and issue areas as rows. Each cell shows:
- A sourced stance or quote (with source link).
- "No public information found" (labeled, never hidden).
- A gap indicator if the field was not evaluated.

**Rules (from PRD):**
- No free-form AI generation in comparison cells.
- Only evidence-linked content drawn from scraped sources.
- "No public information found" is displayed neutrally — it is informative data.

---

### 3.7 Ballot Measure `/measures/[slug]`

**Rendering:** ISR.

**Sections:**
- Official measure title (Official source label).
- Plain-language summary (Machine-assisted summary label, with link to official text).
- Official pro/con statements if published by the jurisdiction.
- Link to official source document.
- Report an issue.

---

### 3.8 Office Explainer `/offices/[slug]`

**Purpose:** Standalone page explaining what a given office does. Also embedded as a card on race pages.

**Rendering:** Static (SSG). Content is generated once by the LLM and cached; never changes during a cycle unless the official description changes.

**Sections:**
- Office name and jurisdiction scope.
- Plain-English explainer text (Machine-assisted summary label, sourced from MD SBE "Offices up for Election").
- List of all current contests for this office (linked).

---

### 3.9 County Index `/counties`

**Purpose:** Entry point for research-intent users who know their county but don't want to run the address lookup.

**Rendering:** Static (SSG). The 24 Maryland jurisdictions are fixed data — no runtime query needed.

**Layout:** Grid of county cards. Each card shows county name and links to `/counties/[slug]`. A map outline of Maryland (SVG) with clickable county regions is a Phase 2 enhancement.

---

### 3.10 County Detail `/counties/[slug]`

**Purpose:** All active races in a single Maryland jurisdiction, organized by office type.

**Rendering:** Static (SSG), rebuilt by deploy webhook when race data changes.

**Sections:**
- County name and election cycle.
- Races grouped by office type (County Executive, County Council, School Board, etc.).
- Each race card links to `/races/[slug]`.
- Links to county board of elections site (sourced from `jurisdictions.county_board_url`).

---

### 3.11 About `/about`

**Purpose:** Explain what MarylandIQ is, who built it, and how the data pipeline works. Critical for establishing trust with skeptical voters.

**Rendering:** Static (SSG). Hardcoded content.

**Sections:**
- What is MarylandIQ?
- Why it exists (the local information gap — from PRD Section 2).
- How data is collected (official sources first, AI enrichment labeled, thin candidate approach).
- The trust label system explained (four label types with examples).
- What MarylandIQ does NOT do (no voter registration data, no stored addresses, no invented content).
- Contact / corrections.
- Open source link (if public repo).

---

### 3.12 Privacy Policy `/privacy`

**Rendering:** Static (SSG). Content sourced from `docs/PRIVACY.md`.

Key privacy points to highlight at top:
- No addresses stored.
- No user accounts.
- Privacy-preserving analytics (Plausible/Umami).
- No third-party ad trackers.

---

### 3.13 Terms of Service `/terms`

**Rendering:** Static (SSG). Content sourced from `docs/TERMS.md`.

---

## 4. Shared Layout & Navigation

### 4.1 Root Layout (`app/layout.tsx`)

Wraps all pages. Contains:
- Site-wide `<head>` metadata defaults (overridden per page).
- Global font variables (Geist Sans, Geist Mono).
- `<Header>` component.
- `<Footer>` component.

### 4.2 Header component

| Element | Always visible | Mobile behavior |
|---|---|---|
| MarylandIQ wordmark / logo | Yes | Yes |
| Search bar (compact) | Desktop only | Collapsed into hamburger |
| "Find my ballot" CTA button | Yes | Yes |
| Nav links: Candidates, Races, Counties, About | Desktop only | Hamburger menu |

### 4.3 Footer component

Three columns:
- **Explore:** Candidates, Races, Counties, Offices
- **Legal:** Privacy Policy, Terms of Service, About
- **Data:** Report an Issue, About the Data, Data Last Updated (timestamp)

Footer also includes a one-line trust statement: "Data sourced from Maryland State Board of Elections and candidate public profiles. Every field is labeled."

---

## 5. Rendering Strategy Summary

| Rendering mode | Used for | Why |
|---|---|---|
| **Static (SSG)** | Homepage, Counties, Office explainers, About, Privacy, Terms | Content is fixed or changes only on full deploy. Fastest possible load. |
| **ISR** | Candidate profiles, Race pages, Comparison, Ballot Measures, County Detail | Data changes on a known event-driven schedule. Rebuild triggered by `trigger_build.py` webhook. Only changed pages rebuild. |
| **Server Component (runtime)** | Ballot Results `/ballot` | Result is voter-specific and cannot be pre-computed. PostGIS query is fast; page is not cached. |
| **Client Component** | Address input, search bar, comparison table sort, "Why am I seeing this?" expandable | Interactivity only. Shell is pre-rendered; JS hydrates specific components. |

---

## 6. URL & Slug Conventions

All slugs use lowercase kebab-case. Cycle (year + election type) is always in the slug to prevent collisions across election cycles.

**Candidate slug:** `[first]-[last]-[jurisdiction-abbrev]-[office-abbrev]-[district]-[year]-[primary|general]`
Example: `jane-smith-pg-council-d4-2026-primary`

**Race/contest slug:** `[jurisdiction-abbrev]-[office-abbrev]-[district]-[year]-[primary|general]`
Example: `pg-county-council-district-4-2026-primary`

**Measure slug:** `[jurisdiction-abbrev]-[short-measure-title]-[year]`
Example: `pg-charter-amendment-school-funding-2026`

**County slug:** `[county-name-kebab]`
Example: `prince-georges-county`, `baltimore-city`

**Office slug:** `[office-name-kebab]`
Example: `county-executive`, `board-of-education`, `register-of-wills`

Slugs are generated at ingest time from the normalized SBE data and stored in the database. Never generated dynamically at render time.

---

## 7. Error & Edge Case Pages

| File | Purpose |
|---|---|
| `app/not-found.tsx` | 404 page — bad slug or expired URL. Links to homepage and candidate search. |
| `app/error.tsx` | Unhandled runtime error. Generic message + link to homepage. |
| `app/loading.tsx` | Loading state for streaming Server Components (ballot results page). |

Withdrawn candidate pages: render normally with a status banner. Do not 404 — withdrawn candidates are still public record and may be searched.

Closed-cycle pages: remain live at permanent URLs. A "This election has concluded" banner appears. Ballot lookup defaults to the most recently closed cycle for historical reference.

---

## 8. SEO & Metadata

Each page sets its own metadata via Next.js `generateMetadata()`:

- **Candidate page:** `"[Full Name] — [Office], [Jurisdiction] | MarylandIQ"`
- **Race page:** `"[Office Name], [District] — [Jurisdiction] | MarylandIQ"`
- **Ballot Measure:** `"[Measure Title] — [Jurisdiction] | MarylandIQ"`
- **County page:** `"[County Name] Elections 2026 | MarylandIQ"`
- **Homepage:** `"MarylandIQ — Maryland Voter Research for Local Elections"`

Canonical URLs are set on all ISR pages. `robots.txt` allows full crawling. A `sitemap.xml` is generated at build time from all active candidate, race, and county slugs.

---

## 9. Trust Label Components

Trust labels are small colored badges rendered as a shared `<TrustLabel>` component. They appear inline within each data section, not as footnotes.

| Label | Color | Usage |
|---|---|---|
| Official source | Blue | SBE data, GIS layers, published results |
| Candidate-submitted | Green | Campaign site, managed social profiles |
| Inferred from public social media | Yellow | AI-extracted from public profiles |
| Machine-assisted summary | Gray | AI-generated text with evidence links |

The `<TrustLabel>` component renders a screen-reader-friendly `aria-label` for WCAG 2.1 AA compliance. Clicking a trust label opens an explainer tooltip describing what that label means.

---

## 10. Accessibility Requirements

- WCAG 2.1 AA compliance site-wide (hard requirement per PRD).
- All trust label badges include `aria-label` text.
- Address input and search bar are keyboard-navigable.
- Comparison table is scrollable horizontally on mobile with sticky candidate name column.
- No critical information is PDF-only or image-only.
- Color is never the sole differentiator for trust level — each label also has a text name.

---

## 11. Phase 2 Additions (not in MVP scope)

| Feature | Route | Notes |
|---|---|---|
| Election Results | `/races/[slug]/results` | After primary/general; winner badge on candidate pages |
| Save My Ballot | `/saved` | Requires user accounts — deferred |
| Municipal Elections | `/municipalities/[slug]` | Phase 2 ingestion module |
| Public Change Log | `/corrections/log` | SLA-backed; email-only for MVP |
| Maryland Map (SVG) | On `/counties` | Clickable SVG county map |

---

*— End of Document —*
