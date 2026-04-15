# Candidate Information Discovery Pipeline
### For Local Maryland Elections — Thin-Data Candidates

---

## The Core Problem

This pipeline is specifically for candidates where you have minimal seed data — typically just a name, office, and jurisdiction from the SBE filing list. No website, no social links, no phone or email on file. These are the hardest cases because the high-precision anchor fields that make entity resolution easy simply don't exist yet. Everything in this document is written with that constraint in mind.

The goal: given only `"John Smith" + "Board of Education" + "Montgomery County"`, discover web pages, social accounts, and other sources that plausibly belong to that specific person, and assign each association a confidence level of low, medium, or high.

---

## Before You Touch the Web: Squeeze the Official Sources First

Even for thin-data candidates, there are two official Maryland sources worth exhausting before issuing any web search. They often contain fields that aren't in the basic candidate CSV.

**SBE Candidate List CSV**
The statewide and all-counties candidate list pages include a "Download CSV" with a last-updated timestamp. Even for thin candidates, this gives you jurisdiction, filing status, filed date, and sometimes a committee name — which is your single most useful disambiguation field.

**Maryland Campaign Finance Database**
Every candidate who files has a registered campaign committee with an address, treasurer name, and registered agent on file. For a candidate with no web presence, the committee address is often a home address, and the treasurer is often a spouse or close associate — both of which are useful for confirming a page match. This is separate from the candidate list CSV and requires a search on elections.maryland.gov/campaign_finance.

Even if all you get is a committee name like "Friends of Jane Doe for BOE District 3," that string is highly specific and searchable.

---

## Retrieval Strategy

### Query Generation

For thin-data candidates, generating good queries matters more than for well-known candidates, because you can't rely on the candidate's own site showing up at the top of results. Generate at least three query variants per candidate:

```
"{full name}" "{office}" {jurisdiction}
"{full name}" "{jurisdiction}" election
"{committee name}" {jurisdiction}           # if you have it from finance DB
"{full name}" site:facebook.com {jurisdiction}
"{full name}" site:linkedin.com
```

For names that are common, always include the district or ward number if you have it. "John Smith Board of Education" is far noisier than "John Smith Board of Education District 3 Howard County."

### Which Search API to Use

**Brave Search API** is currently the most practical choice — active, straightforward pricing, developer-friendly. Bing Search APIs were retired August 2025. Google Custom Search is closed to new customers.

**Tavily** is a newer option worth evaluating. It was designed specifically for LLM-powered pipelines and returns cleaner structured output than general-purpose APIs, which reduces downstream parsing work.

For thin-data candidates specifically, pull more results per query than you normally would — top 15-20 instead of 10 — because the candidate is unlikely to appear in the first few results.

### Civic Aggregators as Priority Seeds

Before issuing generic web searches, check whether the discovery work has already been done:

- **Ballotpedia** — has structured candidate pages for many Maryland local races
- **VoterEdge** (League of Women Voters) — covers some Maryland jurisdictions
- **Maryland Reporter** and local county news sites — often cover local races

A hit on Ballotpedia or VoterEdge is a high-confidence match by itself (they have their own editorial process). Treat these as tier-1 sources and check them first.

---

## Fetching and Crawling

### Basic Fetch Pipeline

For thin-data candidates, most discovered pages will be static — local news articles, civic org pages, a simple campaign site if one exists. You don't need heavy infrastructure to start. A simple pipeline:

1. Fetch HTML with `requests` (or `httpx` for async)
2. Extract main content with **Trafilatura** — strips nav menus, footers, cookie banners
3. Parse for signals (emails, phones, names, office phrases)
4. Only escalate to **Playwright** (headless browser) if the page is JS-heavy and extraction fails

### Crawling Rules

Always respect `robots.txt` (RFC 9309). Set a descriptive `User-Agent` that identifies your project. Rate-limit your requests — local news and county government sites are not built for high traffic. A delay of 1-2 seconds between requests to the same domain is reasonable.

Scrapy handles this cleanly if you want a full crawling framework:
- `ROBOTSTXT_OBEY = True`
- `AutoThrottle` extension for adaptive rate limiting
- `HttpCacheMiddleware` for caching (critical for iterating without re-fetching)
- `RetryMiddleware` for transient failures

### How Deep to Crawl

For thin-data candidates, limit crawl depth to 1-2 hops from your seed URLs. You're looking for a campaign page, a social profile, or a news mention — not building a general index. A URL budget of 20-30 pages per candidate is a reasonable starting point.

---

## Signal Extraction

What you extract from each page determines how good your confidence scores can be. For thin-data candidates, you're primarily looking for:

**Strong identity signals**
- Email addresses (even partial — `jane@` with a domain can be matched)
- Phone numbers
- "Paid for by [committee name]" attribution lines
- Official social links embedded in the page (not just embeds — actual outbound links)

**Medium identity signals**
- Full name appearing in the title or H1
- Office and district phrase appearing together (e.g., "Board of Education District 3")
- County or jurisdiction name alongside the candidate name
- Committee name appearing anywhere on the page

**Structural signals**
- Schema.org JSON-LD with a `Person` type — can hand you `sameAs` links to social profiles
- OpenGraph meta tags
- Outbound links to Facebook, Instagram, Twitter/X, ActBlue, or other campaign platforms

Extract all of these into an evidence record per page:

```python
{
    "url": str,
    "canonical_url": str,
    "title": str,
    "h1": str,
    "emails": list[str],
    "phones": list[str],
    "committee_mentions": list[str],
    "office_phrases": list[str],
    "jurisdiction_mentions": list[str],
    "outbound_social_links": list[str],
    "fetched_at": datetime,
    "http_status": int
}
```

### Social Media Discovery

Facebook, Instagram, and LinkedIn have largely shut down general API access, so direct API calls are not an option. What works:

- Issue search API queries with site operators: `"Jane Doe" "Board of Education" site:facebook.com`
- Same pattern for LinkedIn and Twitter/X — the public search index surfaces profile pages
- Extract what you can from the search snippet; don't expect to scrape the profile page itself (LinkedIn aggressively blocks it)
- The most reliable signal is an outbound social link on the candidate's own page — if it exists

---

## Confidence Scoring

### The Scoring Model

For thin-data candidates, the absence of high-precision anchor fields (no official email, no official site on file) means you will see more medium-confidence results and fewer high-confidence ones. That is expected and correct — don't inflate scores to compensate.

A weighted feature model is the right starting point:

| Signal | Weight | Notes |
|---|---|---|
| Email match vs. finance DB email | 3.0 | Rare for thin candidates but definitive |
| Phone match vs. finance DB phone | 3.0 | Same |
| Official site match | 3.0 | Only if SBE record has a site on file |
| Committee name exact match | 2.5 | Very useful for thin candidates |
| Full name in title/H1 + office phrase | 1.5 | Both must be present |
| Jurisdiction mention + office mention | 1.0 | |
| District/ward mention | 0.5 | |
| Name only (no other signals) | 0.0 | Never sufficient by itself |

**Thresholds:**
- **High (≥ 4.0):** At least one strong identifier match, or committee name match plus name + office on page
- **Medium (2.0–3.9):** Name and office present but no unique identifier; plausible but needs review
- **Low (< 2.0):** Name only, or conflicting jurisdiction signals

### Handling Common Names

For thin-data candidates with common names, enforce a stricter policy: require at least one medium signal beyond name match before assigning medium confidence. A page mentioning "John Smith" in Maryland without any office, district, or committee context should be low confidence regardless of score.

---

## Using an LLM in the Pipeline

The failure mode you've already encountered — the LLM inferring confidence from vague scraped text — happens when the model is asked to decide without structured evidence. The correct pattern is:

**Use the LLM as an extractor, not a judge.**

```
1. Parse HTML, extract signals deterministically (emails, phones, names, office phrases)
2. LLM extracts any remaining structured fields from cleaned text:
       "What office is this person running for?"
       "What county or district is mentioned?"
       "Is there a committee name or 'paid for by' attribution?"
3. Score numerically using the weighted model above
4. LLM writes a plain-language rationale citing only the fields you extracted
```

When you do use the LLM as a classifier, constrain it strictly. Require JSON output:

```json
{
  "decision": "medium",
  "evidence_used": ["name in H1", "office phrase 'Board of Education District 3'", "jurisdiction 'Howard County'"],
  "missing_evidence": ["no email match", "no committee name found"],
  "contradictions": []
}
```

Reject any output that cites evidence not present in your extracted fields. This prevents the model from helpfully guessing.

For thin-data candidates specifically: the LLM is most useful for extracting office and jurisdiction phrases from messy news article text, where a candidate might be mentioned in passing rather than featured. It is less useful for deciding whether a social profile is the right person — that decision should be made by the scoring model.

---

## Implementation Sequence

Given that this pipeline is specifically for thin-data candidates on what is likely a small team, a phased approach makes more sense than building the full system upfront.

**Phase 1 — Seed enrichment (before any web search)**
Pull SBE CSV + campaign finance DB. Even for thin candidates, this sometimes surfaces a committee name, address, or treasurer that becomes a strong anchor. Store whatever you find.

**Phase 2 — Search and priority source check**
Check Ballotpedia and VoterEdge first. Then issue Brave/Tavily queries with 3 variants per candidate. Pull top 15-20 results per query, deduplicate URLs.

**Phase 3 — Fetch and extract**
Fetch pages, extract evidence records, run the weighted scoring model. Flag anything scoring 2.0-3.9 for review — that is your medium-confidence bucket and it will be large for thin-data candidates.

**Phase 4 — LLM extraction pass**
For pages that scored medium or where key fields were missing, run the LLM extraction step to pull structured fields from body text. Re-score with any newly extracted fields.

**Phase 5 — Review loop**
Build a simple review queue for medium-confidence associations. As you confirm or reject matches, you're building a labeled dataset. Once you have ~150-200 labeled pairs, you can train a proper linkage model (Dedupe or Splink) and replace the heuristic weights.

---

## Provenance and Voter-Facing Display

For a voter-facing site, provenance is not an optional feature — it is how you avoid causing harm. Local candidates have very low name recognition, and a false association can be decisive. Every association your pipeline surfaces should carry:

- The exact source URL
- The date it was fetched
- The confidence level
- A plain-language explanation of why (e.g., "Candidate name and 'Board of Education District 3' both appear in the page title; committee name matches campaign finance filing")
- A way for the candidate or a user to flag a disputed attribution

Show the confidence level visibly in your UI. A voter seeing a "low confidence" tag on a social profile link is in a better position than one who assumes it was verified.

---

## Tools Reference

| Tool | Purpose | Link |
|---|---|---|
| Brave Search API | Web search | api-dashboard.search.brave.com |
| Tavily | LLM-optimized search | tavily.com |
| Scrapy | Crawling framework | docs.scrapy.org |
| Playwright (Python) | JS-heavy pages | playwright.dev/python |
| Trafilatura | Main content extraction | trafilatura.readthedocs.io |
| Dedupe | Active-learning record linkage | docs.dedupe.io |
| Splink | Probabilistic record linkage | moj-analytical-services.github.io/splink |

**Maryland data sources:**
- SBE Candidate List + CSV: elections.maryland.gov
- Campaign Finance DB: elections.maryland.gov/campaign_finance
- Ballotpedia: ballotpedia.org
- VoterEdge: voterguide.lwv.org
