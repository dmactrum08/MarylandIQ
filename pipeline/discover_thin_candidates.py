"""
discover_thin_candidates.py

Replaces scrape_social_media.py. Five-phase discovery pipeline for thin-data
candidates (completeness_score < 40):

  Phase 1  Campaign Finance DB  Fetch committee name/treasurer (stub — see FINANCE_SEARCH_URL)
  Phase 2  URL seeding          Ballotpedia direct check + Brave Search API (3-5 query variants)
  Phase 3  Fetch + score        requests + trafilatura + weighted evidence model
  Phase 4  LLM extraction       Structured field extraction on medium-confidence pages only
  Phase 5  Persist              Write evidence record; populate social_inference_text for
                                backward compatibility with enrich_candidates.py

Key differences from scrape_social_media.py:
  - No direct social media scraping (always hits login walls)
  - Uses Brave Search API instead of DuckDuckGo HTML scraping
  - Checks MD Campaign Finance DB for committee name before searching
  - Checks Ballotpedia directly before issuing generic queries
  - LLM is an extractor of structured fields, not a binary YES/NO validator
  - Stores scored evidence records with provenance, not raw scraped text

Requires:
  BRAVE_SEARCH_API_KEY in .env
  trafilatura: pip install trafilatura

Usage:
  python -m pipeline.discover_thin_candidates
  python -m pipeline.discover_thin_candidates --backend gemini
  python -m pipeline.discover_thin_candidates --limit 50
  python -m pipeline.discover_thin_candidates --dry-run   # score only, no DB writes
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

from pipeline.utils.supabase_client import get_client

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

THIN_THRESHOLD = 40

SERPER_SEARCH_URL = "https://google.serper.dev/search"
SERPER_RESULTS_COUNT = 10      # Serper returns up to 10 organic results per query

BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"
BRAVE_RESULTS_COUNT = 20       # pull more results; thin candidates rarely rank top-5
BRAVE_RATE_SLEEP = 1.1         # seconds between Brave calls (free tier: 1 req/s)

DOMAIN_CRAWL_SLEEP = 1.5       # seconds between requests to the same domain
FETCH_TIMEOUT = 12             # seconds per page fetch
MAX_BODY_CHARS = 5000          # chars of page body sent to LLM for extraction
MAX_SOCIAL_TEXT_CHARS = 4000   # chars stored in social_inference_text (enrich compat)

MIN_SCORE_TO_STORE = 1.5       # discard pages scoring below this
MAX_EVIDENCE_STORED = 5        # top N evidence records written to discovery_evidence

BALLOTPEDIA_BASE = "https://ballotpedia.org"

# MD Campaign Finance DB — NEEDS VERIFICATION BEFORE USE.
#
# Maryland migrated its campaign finance platform to campaignfinance.maryland.gov
# (MD CRIS). The legacy domain campaignfinancemd.us may return 403 or stale data.
#
# To wire this up correctly:
#   1. Open campaignfinance.maryland.gov in a browser
#   2. Run a committee search for any known candidate
#   3. Capture the real network request in DevTools (URL, method, params, headers)
#   4. Replace FINANCE_SEARCH_URL and the params dict in fetch_finance_data() below
#
# Until then, fetch_finance_data() will log a warning and return empty FinanceData.
# The rest of the pipeline continues without the committee name anchor.
FINANCE_SEARCH_URL = "https://campaignfinance.maryland.gov"  # placeholder — see above

USER_AGENT = (
    "MarylandIQ-Pipeline/1.0 "
    "(nonpartisan voter info platform; "
    "github.com/marylandiq)"
)

# Browser-like UA used for page fetches so editorial sites (Ballotpedia, news,
# candidate websites) don't reject us with bot-detection or Cloudflare challenges.
# The pipeline UA above is still used for Brave API requests where we identify ourselves.
FETCH_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# Weighted scoring model — from Maryland_Candidate_Pipeline.md
SCORE_EMAIL_OR_PHONE_MATCH = 3.0   # match vs finance DB contact (rare but definitive)
SCORE_OFFICIAL_SITE_MATCH = 3.0    # SBE-listed campaign website
SCORE_COMMITTEE_EXACT = 2.5        # committee name found on page
SCORE_NAME_TITLE_AND_OFFICE = 1.5  # full name in title/H1 AND office phrase present
SCORE_JURISDICTION_AND_OFFICE = 1.0
SCORE_DISTRICT_MENTION = 0.5
SCORE_SOURCE_BALLOTPEDIA = 1.0     # editorial process is its own signal
SCORE_SOURCE_CIVIC = 0.5           # VoterEdge, vote411, votesmart
SCORE_SOURCE_COMMITTEE_FILING = 3.0  # URL came directly from official MD Campaign Finance filing
SCORE_EMAIL_MATCH = 3.0            # page contains the candidate's filing email address

HIGH_CONFIDENCE = 4.0
MEDIUM_CONFIDENCE_MIN = 2.0

# Contradiction penalty — deducted when a different MD jurisdiction appears prominently
PENALTY_WRONG_JURISDICTION = -1.0

# All 24 Maryland jurisdictions — used for contradiction detection
_MD_JURISDICTIONS = {
    "Allegany County", "Anne Arundel County", "Baltimore City",
    "Baltimore County", "Calvert County", "Caroline County",
    "Carroll County", "Cecil County", "Charles County",
    "Dorchester County", "Frederick County", "Garrett County",
    "Harford County", "Howard County", "Kent County",
    "Montgomery County", "Prince George's County", "Queen Anne's County",
    "Saint Mary's County", "Somerset County", "Talbot County",
    "Washington County", "Wicomico County", "Worcester County",
}

# MD Campaign Finance county name as used in their search form.
# Maps our jurisdiction strings to the short form the finance DB expects.
_FINANCE_COUNTY_MAP: dict[str, str] = {
    "Allegany County": "Allegany",
    "Anne Arundel County": "Anne Arundel",
    "Baltimore City": "Baltimore City",
    "Baltimore County": "Baltimore",
    "Calvert County": "Calvert",
    "Caroline County": "Caroline",
    "Carroll County": "Carroll",
    "Cecil County": "Cecil",
    "Charles County": "Charles",
    "Dorchester County": "Dorchester",
    "Frederick County": "Frederick",
    "Garrett County": "Garrett",
    "Harford County": "Harford",
    "Howard County": "Howard",
    "Kent County": "Kent",
    "Montgomery County": "Montgomery",
    "Prince George's County": "Prince George's",
    "Queen Anne's County": "Queen Anne's",
    "Saint Mary's County": "Saint Mary's",
    "Somerset County": "Somerset",
    "Talbot County": "Talbot",
    "Washington County": "Washington",
    "Wicomico County": "Wicomico",
    "Worcester County": "Worcester",
}

LOGIN_WALL_PHRASES = [
    "log in to facebook",
    "you must log in",
    "sign in to twitter",
    "join linkedin",
    "sign up to see",
    "create an account",
    "please log in",
    "log in or sign up",
]

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(r"\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}")
COMMITTEE_RE = re.compile(
    r"(?:Friends of|Committee to (?:Elect|Re-Elect)|Paid for by|Authorized by)"
    r"[^.;\n]{3,70}",
    re.IGNORECASE,
)

SOCIAL_DOMAINS = (
    "facebook.com", "twitter.com", "x.com",
    "instagram.com", "linkedin.com", "youtube.com",
)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class ThinCandidate:
    candidate_id: str
    full_name: str
    office_name: str
    jurisdiction: str
    district_name: Optional[str]
    campaign_website_url: Optional[str]


@dataclass
class FinanceData:
    committee_name: Optional[str] = None
    treasurer_name: Optional[str] = None
    address: Optional[str] = None
    candidate_email: Optional[str] = None
    candidate_phone: Optional[str] = None
    facebook_url: Optional[str] = None
    instagram_url: Optional[str] = None
    twitter_handle: Optional[str] = None
    linkedin_url: Optional[str] = None
    website_url: Optional[str] = None


@dataclass
class EvidenceRecord:
    url: str
    title: str
    h1: str
    source_type: str                        # ballotpedia|civic|campaign|local|social|other
    body_text: Optional[str]               # trafilatura-extracted clean text
    emails: list[str] = field(default_factory=list)
    phones: list[str] = field(default_factory=list)
    committee_mentions: list[str] = field(default_factory=list)
    office_phrases: list[str] = field(default_factory=list)
    jurisdiction_mentions: list[str] = field(default_factory=list)
    district_mentions: list[str] = field(default_factory=list)
    outbound_social_links: list[str] = field(default_factory=list)
    score: float = 0.0
    confidence: str = "low"
    rationale: str = ""
    llm_extraction: Optional[dict] = None
    fetched_at: str = ""
    http_status: int = 0


# ---------------------------------------------------------------------------
# Domain rate limiter
# ---------------------------------------------------------------------------

_domain_last_request: dict[str, float] = {}


def _rate_limited_get(url: str, **kwargs) -> Optional[requests.Response]:
    domain = urlparse(url).netloc
    elapsed = time.monotonic() - _domain_last_request.get(domain, 0.0)
    wait = DOMAIN_CRAWL_SLEEP - elapsed
    if wait > 0:
        time.sleep(wait)
    _domain_last_request[domain] = time.monotonic()
    try:
        return requests.get(
            url,
            headers={
                "User-Agent": FETCH_USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=FETCH_TIMEOUT,
            allow_redirects=True,
            **kwargs,
        )
    except Exception as exc:
        log.debug(f"Fetch error {url}: {exc}")
        return None


# ---------------------------------------------------------------------------
# Phase 1 — Maryland Campaign Finance DB
# ---------------------------------------------------------------------------

def fetch_finance_data(candidate: ThinCandidate) -> FinanceData:
    """
    Look up the candidate's committee record from the local CSV index.

    Returns a populated FinanceData with committee name, email, and any social
    URLs filed with Maryland Campaign Finance. Returns empty FinanceData if not found.

    The CSV is loaded once and cached by finance_index.load_index().
    Refresh it by re-downloading from campaignfinance.maryland.gov/public/cf/downloads.
    """
    from pipeline.utils.finance_index import lookup as fi_lookup

    rec = fi_lookup(candidate.full_name, candidate.jurisdiction)
    if not rec:
        log.debug(f"No committee record found for {candidate.full_name}")
        return FinanceData()

    log.info(
        f"  Finance: committee='{rec.committee_name}'"
        + (f" email='{rec.candidate_email}'" if rec.candidate_email else "")
        + (f" website='{rec.website_url}'" if rec.website_url else "")
    )
    return FinanceData(
        committee_name=rec.committee_name or None,
        treasurer_name=rec.treasurer_name,
        address=rec.address,
        candidate_email=rec.candidate_email,
        candidate_phone=rec.candidate_phone,
        facebook_url=rec.facebook_url,
        instagram_url=rec.instagram_url,
        twitter_handle=rec.twitter_handle,
        linkedin_url=rec.linkedin_url,
        website_url=rec.website_url,
    )


# ---------------------------------------------------------------------------
# Phase 2 — URL seed generation
# ---------------------------------------------------------------------------

def _ballotpedia_url(name: str) -> str:
    return f"{BALLOTPEDIA_BASE}/{name.replace(' ', '_')}"


def _classify_url(url: str, jurisdiction: str) -> str:
    if "ballotpedia.org" in url:
        return "ballotpedia"
    if any(d in url for d in SOCIAL_DOMAINS):
        return "social"
    if any(d in url for d in ("voterguide.lwv.org", "votesmart.org", "vote411.org", "voterguide.")):
        return "civic"
    if jurisdiction.lower().replace(" ", "").replace("county", "") in url.lower():
        return "local"
    return "other"


_FREE_EMAIL_DOMAINS = frozenset({
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
    "aol.com", "icloud.com", "me.com", "msn.com",
})


def _campaign_email_domain(email: Optional[str]) -> Optional[str]:
    """
    Return the domain of a campaign email if it looks like a dedicated campaign site
    (not Gmail/Yahoo/etc.). E.g. 'jane@janeforcouncil.com' → 'janeforcouncil.com'.
    Returns None for free email providers.
    """
    if not email or "@" not in email:
        return None
    domain = email.split("@", 1)[1].lower().strip()
    if domain in _FREE_EMAIL_DOMAINS:
        return None
    return domain


def generate_query_variants(candidate: ThinCandidate, finance: FinanceData) -> list[str]:
    name = candidate.full_name
    office = candidate.office_name
    jur = candidate.jurisdiction
    queries: list[str] = []

    # Most specific first — district number if available
    if candidate.district_name:
        queries.append(f'"{name}" "{office}" "{candidate.district_name}" {jur} Maryland')

    queries += [
        f'"{name}" "{office}" {jur} Maryland',
        f'"{name}" {jur} election 2026',
        f'"{name}" Maryland candidate',
    ]

    # Committee name is highly specific — insert near the top if we have it
    if finance.committee_name:
        queries.insert(1, f'"{finance.committee_name}" {jur}')

    # Broad campaign website query — finds thin sites that don't rank for exact phrases.
    # Omit quotes around name so partial matches on thin/new sites are included.
    # "campaign" OR "elect" signals we want the candidate's own site, not news articles.
    name_parts = name.split()
    last_name = name_parts[-1] if name_parts else name
    queries.append(f'{name} {jur} Maryland campaign 2026')
    queries.append(f'"{last_name}" {office} {jur} campaign site')

    return queries


def serper_search(query: str, api_key: str) -> list[dict]:
    """Google Search via Serper.dev — primary search provider."""
    try:
        resp = requests.post(
            SERPER_SEARCH_URL,
            headers={
                "X-API-KEY": api_key,
                "Content-Type": "application/json",
            },
            json={"q": query, "num": SERPER_RESULTS_COUNT},
            timeout=15,
        )
        if not resp.ok:
            log.warning(
                f"Serper search {resp.status_code} ({query[:60]!r}): {resp.text[:300]}"
            )
            return []
    except Exception as exc:
        log.warning(f"Serper search error ({query[:60]!r}): {exc}")
        return []

    results = resp.json().get("organic", [])
    return [
        {"url": r["link"], "title": r.get("title", ""), "description": r.get("snippet", "")}
        for r in results
        if r.get("link")
    ]


def brave_search(query: str, api_key: str) -> list[dict]:
    time.sleep(BRAVE_RATE_SLEEP)
    try:
        resp = requests.get(
            BRAVE_SEARCH_URL,
            headers={
                "Accept": "application/json",
                "X-Subscription-Token": api_key,
            },
            params={
                "q": query,
                "count": BRAVE_RESULTS_COUNT,
            },
            timeout=15,
        )
        if not resp.ok:
            log.warning(
                f"Brave search {resp.status_code} ({query[:60]!r}): {resp.text[:300]}"
            )
            return []
    except Exception as exc:
        log.warning(f"Brave search error ({query[:60]!r}): {exc}")
        return []

    results = resp.json().get("web", {}).get("results", [])
    return [
        {"url": r["url"], "title": r.get("title", ""), "description": r.get("description", "")}
        for r in results
    ]


def web_search(
    query: str,
    serper_key: Optional[str],
    brave_key: Optional[str],
) -> list[dict]:
    """
    Try Serper (Google) first; fall back to Brave if Serper is unavailable or empty.
    Returns a list of {url, title, description} dicts.
    """
    if serper_key:
        results = serper_search(query, serper_key)
        if results:
            return results
        log.debug(f"Serper returned no results for {query[:60]!r}, trying Brave")
    if brave_key:
        return brave_search(query, brave_key)
    return []


def collect_seed_urls(
    candidate: ThinCandidate,
    finance: FinanceData,
    serper_key: Optional[str],
    brave_key: Optional[str],
) -> list[dict]:
    """
    Return deduplicated list of {url, title, description, source_type} dicts.
    Ballotpedia direct URL is always checked first. Campaign website is seeded
    directly if present. Serper (Google) provides search results; Brave is the fallback.
    """
    seen: set[str] = set()
    seeds: list[dict] = []

    def _add(url: str, title: str, description: str, source_type: str) -> None:
        parsed = urlparse(url)
        key = parsed._replace(
            scheme=parsed.scheme.lower(),
            netloc=parsed.netloc.lower(),
        ).geturl().rstrip("/")
        if key not in seen:
            seen.add(key)
            seeds.append(
                {"url": url, "title": title, "description": description, "source_type": source_type}
            )

    # Committee filing URLs — authoritative, from official MD Campaign Finance filing.
    # Add these first; they score as "committee_filing" source type.
    if finance.website_url:
        _add(finance.website_url, "Committee filing: website", "", "committee_filing")
    if finance.facebook_url:
        _add(finance.facebook_url, "Committee filing: Facebook", "", "committee_filing")
    if finance.instagram_url:
        _add(finance.instagram_url, "Committee filing: Instagram", "", "committee_filing")
    if finance.twitter_handle:
        _add(
            f"https://x.com/{finance.twitter_handle}",
            "Committee filing: Twitter/X",
            "",
            "committee_filing",
        )
    if finance.linkedin_url:
        _add(finance.linkedin_url, "Committee filing: LinkedIn", "", "committee_filing")

    # Campaign website already in SBE/DB record
    if candidate.campaign_website_url:
        _add(candidate.campaign_website_url, "Campaign website", "", "campaign")

    # Campaign email domain — if the candidate filed with a non-Gmail address,
    # the domain is almost always their campaign site (e.g. janeforcouncil.com)
    email_domain = _campaign_email_domain(finance.candidate_email)
    if email_domain:
        _add(
            f"https://{email_domain}",
            f"Campaign email domain: {email_domain}",
            "",
            "campaign",
        )

    # Always check Ballotpedia directly — a hit here is high-confidence by itself
    _add(_ballotpedia_url(candidate.full_name), f"Ballotpedia: {candidate.full_name}", "", "ballotpedia")

    # Web search — Serper (Google) primary, Brave fallback
    for query in generate_query_variants(candidate, finance):
        for r in web_search(query, serper_key, brave_key):
            _add(
                r["url"],
                r["title"],
                r["description"],
                _classify_url(r["url"], candidate.jurisdiction),
            )

    log.info(f"  Seeded {len(seeds)} unique URLs:")
    for s in seeds:
        log.info(f"    [{s['source_type']}] {s['url'][:100]}")
    return seeds


# ---------------------------------------------------------------------------
# Phase 3 — Fetch + evidence extraction + scoring
# ---------------------------------------------------------------------------

def _is_login_wall(text: str) -> bool:
    lower = text.lower()
    return any(p in lower for p in LOGIN_WALL_PHRASES)


def _extract_main_content(html: str) -> Optional[str]:
    """Extract main body text via trafilatura; fall back to BeautifulSoup."""
    try:
        import trafilatura
        content = trafilatura.extract(html, include_links=False, include_comments=False)
        if content and len(content) > 100:
            return content
    except ImportError:
        pass

    # Fallback: strip chrome and return remaining text
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header", "svg"]):
        tag.decompose()
    text = " ".join(soup.get_text(" ", strip=True).split())
    return text if len(text) > 100 else None


def _extract_jsonld(soup: BeautifulSoup) -> list[dict]:
    results = []
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
            if isinstance(data, dict):
                results.append(data)
            elif isinstance(data, list):
                results.extend(d for d in data if isinstance(d, dict))
        except (json.JSONDecodeError, TypeError):
            pass
    return results


def _extract_outbound_social_links(soup: BeautifulSoup) -> list[str]:
    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if any(d in href for d in SOCIAL_DOMAINS):
            links.append(href)
    return list(dict.fromkeys(links))


def _find_office_phrases(text: str, office_name: str) -> list[str]:
    phrases = []
    lower = text.lower()
    office_lower = office_name.lower()
    idx = lower.find(office_lower)
    while idx != -1 and len(phrases) < 5:
        start = max(0, idx - 40)
        end = min(len(text), idx + len(office_name) + 40)
        phrases.append(text[start:end].strip())
        idx = lower.find(office_lower, idx + 1)
    return phrases


def fetch_and_extract(seed: dict, candidate: ThinCandidate) -> Optional[EvidenceRecord]:
    """Fetch a URL and return a populated EvidenceRecord, or None if unusable."""
    url = seed["url"]
    resp = _rate_limited_get(url)
    if not resp:
        log.info(f"  [skip network-error] {url[:90]}")
        return None
    if resp.status_code == 404:
        log.info(f"  [skip 404] {url[:90]}")
        return None
    if resp.status_code != 200:
        log.info(f"  [skip HTTP-{resp.status_code}] {url[:90]}")
        return None

    html = resp.text
    soup = BeautifulSoup(html, "lxml")
    body_text = _extract_main_content(html)
    if not body_text:
        log.info(f"  [skip no-content] {url[:90]}")
        return None
    if _is_login_wall(body_text):
        log.info(f"  [skip login-wall] {url[:90]}")
        return None

    title = soup.title.get_text(strip=True) if soup.title else seed.get("title", "")
    h1_tag = soup.find("h1")
    h1 = h1_tag.get_text(strip=True) if h1_tag else ""

    full_text = f"{title} {h1} {body_text}"

    emails = list(dict.fromkeys(EMAIL_RE.findall(full_text)))[:10]
    phones = list(dict.fromkeys(PHONE_RE.findall(full_text)))[:5]
    committee_mentions = list(dict.fromkeys(COMMITTEE_RE.findall(full_text)))[:5]
    office_phrases = _find_office_phrases(full_text, candidate.office_name)

    jur_mentions = list(dict.fromkeys(
        re.findall(rf"\b{re.escape(candidate.jurisdiction)}\b", full_text, re.IGNORECASE)
    ))[:5]

    district_mentions: list[str] = []
    if candidate.district_name:
        district_mentions = list(dict.fromkeys(
            re.findall(rf"\b{re.escape(candidate.district_name)}\b", full_text, re.IGNORECASE)
        ))[:5]

    # Outbound social links — most reliable social signal when found
    outbound_social = _extract_outbound_social_links(soup)
    # Also mine Schema.org sameAs links
    for entry in _extract_jsonld(soup):
        same_as = entry.get("sameAs", [])
        if isinstance(same_as, str):
            same_as = [same_as]
        outbound_social.extend(
            link for link in same_as if any(d in link for d in SOCIAL_DOMAINS)
        )
    outbound_social = list(dict.fromkeys(outbound_social))[:10]

    return EvidenceRecord(
        url=url,
        title=title,
        h1=h1,
        source_type=seed["source_type"],
        body_text=body_text[:MAX_BODY_CHARS],
        emails=emails,
        phones=phones,
        committee_mentions=committee_mentions,
        office_phrases=office_phrases,
        jurisdiction_mentions=jur_mentions,
        district_mentions=district_mentions,
        outbound_social_links=outbound_social,
        fetched_at=datetime.now(timezone.utc).isoformat(),
        http_status=resp.status_code,
    )


def score_record(
    record: EvidenceRecord,
    candidate: ThinCandidate,
    finance: FinanceData,
) -> float:
    score = 0.0
    name_lower = candidate.full_name.lower()
    office_lower = candidate.office_name.lower()
    jur_lower = candidate.jurisdiction.lower()

    full_lower = f"{record.title} {record.h1} {record.body_text or ''}".lower()

    # Committee name exact match — most useful for thin candidates
    if finance.committee_name:
        cn = finance.committee_name.lower()
        if cn in full_lower or any(cn in m.lower() for m in record.committee_mentions):
            score += SCORE_COMMITTEE_EXACT

    # Full name in title or H1, plus office phrase present
    name_in_prominent = name_lower in record.title.lower() or name_lower in record.h1.lower()
    has_office = bool(record.office_phrases) or office_lower in full_lower
    if name_in_prominent and has_office:
        score += SCORE_NAME_TITLE_AND_OFFICE
    elif name_in_prominent:
        score += 0.5  # name present but no office context

    # Jurisdiction + office together
    has_jur = bool(record.jurisdiction_mentions) or jur_lower in full_lower
    if has_jur and has_office:
        score += SCORE_JURISDICTION_AND_OFFICE

    # District mention
    if record.district_mentions:
        score += SCORE_DISTRICT_MENTION

    # Email match — page contains the candidate's official filing email
    if finance.candidate_email and finance.candidate_email.lower() in full_lower:
        score += SCORE_EMAIL_MATCH

    # Source-type bonuses
    if record.source_type == "committee_filing":
        # URL came directly from the candidate's own campaign finance filing
        score += SCORE_SOURCE_COMMITTEE_FILING
    elif record.source_type == "ballotpedia":
        score += SCORE_SOURCE_BALLOTPEDIA
    elif record.source_type == "civic":
        score += SCORE_SOURCE_CIVIC

    # Campaign website already on file — if SBE record matches, definitive
    if record.source_type == "campaign" and candidate.campaign_website_url:
        score += SCORE_OFFICIAL_SITE_MATCH

    # Contradiction penalties — penalise when a different MD jurisdiction
    # appears prominently without the target jurisdiction.
    # This catches pages about a same-named candidate in another county.
    other_jur_found = any(
        other.lower() in full_lower
        for other in _MD_JURISDICTIONS
        if other.lower() != jur_lower
    )
    if other_jur_found and not has_jur:
        # A different Maryland jurisdiction is mentioned and ours is absent —
        # strong signal this is the wrong person.
        score += PENALTY_WRONG_JURISDICTION

    return round(score, 2)


def confidence_from_score(score: float) -> str:
    if score >= HIGH_CONFIDENCE:
        return "high"
    if score >= MEDIUM_CONFIDENCE_MIN:
        return "medium"
    return "low"


def build_rationale(
    record: EvidenceRecord,
    candidate: ThinCandidate,
    finance: FinanceData,
) -> str:
    parts: list[str] = []
    name_lower = candidate.full_name.lower()

    if name_lower in record.title.lower():
        parts.append(f"Name in title: '{record.title[:80]}'")
    elif name_lower in record.h1.lower():
        parts.append(f"Name in H1: '{record.h1[:80]}'")

    if record.office_phrases:
        parts.append(f"Office phrase: '{record.office_phrases[0][:60]}'")

    if record.jurisdiction_mentions:
        parts.append(f"Jurisdiction '{candidate.jurisdiction}' mentioned")

    if record.district_mentions and candidate.district_name:
        parts.append(f"District '{candidate.district_name}' mentioned")

    if finance.committee_name and (
        record.committee_mentions or
        finance.committee_name.lower() in (record.body_text or "").lower()
    ):
        parts.append(f"Committee match: '{finance.committee_name[:60]}'")

    if finance.candidate_email and record.body_text and finance.candidate_email.lower() in record.body_text.lower():
        parts.append(f"Email match: '{finance.candidate_email}' found on page")

    if record.source_type == "committee_filing":
        parts.append("Source: URL from official MD Campaign Finance filing")
    elif record.source_type == "ballotpedia":
        parts.append("Source: Ballotpedia (editorial review process)")
    elif record.source_type == "campaign":
        parts.append("Source: candidate's own campaign website")

    if not parts:
        parts.append("No strong corroborating signals found")

    return "; ".join(parts)


# ---------------------------------------------------------------------------
# Phase 4 — LLM extraction pass (medium-confidence pages only)
# ---------------------------------------------------------------------------

_LLM_EXTRACT_SYSTEM = (
    "You are a data extractor for a nonpartisan voter information platform. "
    "Extract structured fields from the provided web page text. "
    "Return ONLY valid JSON. No markdown fences. No explanation. No preamble."
)

_LLM_EXTRACT_PROMPT = """\
Candidate on record: {name}, running for {office} in {jurisdiction}, Maryland, 2026.

Page URL: {url}
Page title: {title}

Page text (excerpt):
{text}

Extract the following fields. Set to null if not clearly present in the text above.
Return ONLY this JSON — no other output:
{{
  "office_mentioned": null,
  "jurisdiction_mentioned": null,
  "district_mentioned": null,
  "committee_name": null,
  "candidate_name_found": null,
  "paid_for_by": null
}}"""

_EXPECTED_LLM_KEYS = frozenset({
    "office_mentioned", "jurisdiction_mentioned", "district_mentioned",
    "committee_name", "candidate_name_found", "paid_for_by",
})


def llm_extract_fields(
    record: EvidenceRecord,
    candidate: ThinCandidate,
    backend,
) -> Optional[dict]:
    """
    Run structured extraction on a medium-confidence page.
    Returns only non-null string fields that match known keys.
    Rejects anything the model invented outside the schema.
    """
    prompt = _LLM_EXTRACT_PROMPT.format(
        name=candidate.full_name,
        office=candidate.office_name,
        jurisdiction=candidate.jurisdiction,
        url=record.url,
        title=record.title,
        text=(record.body_text or "")[:MAX_BODY_CHARS],
    )
    try:
        raw = backend.call(prompt, system_prompt=_LLM_EXTRACT_SYSTEM).strip()
        backend.sleep_between_calls()
    except Exception as exc:
        log.warning(f"LLM extraction error ({record.url[:60]}): {exc}")
        return None

    # Strip thinking blocks and markdown fences
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned.strip())

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        log.debug(f"LLM extraction JSON parse failed: {raw[:100]!r}")
        return None

    # Only keep fields in our schema with non-null string values
    return {
        k: v.strip()
        for k, v in parsed.items()
        if k in _EXPECTED_LLM_KEYS and isinstance(v, str) and v.strip()
    } or None


def apply_llm_fields(
    record: EvidenceRecord,
    llm: dict,
    candidate: ThinCandidate,
    finance: FinanceData,
) -> EvidenceRecord:
    """Merge LLM-extracted fields into the evidence record and re-score."""
    record.llm_extraction = llm

    if llm.get("office_mentioned") and not record.office_phrases:
        record.office_phrases = [llm["office_mentioned"]]

    if llm.get("jurisdiction_mentioned") and not record.jurisdiction_mentions:
        record.jurisdiction_mentions = [llm["jurisdiction_mentioned"]]

    if llm.get("district_mentioned") and not record.district_mentions:
        record.district_mentions = [llm["district_mentioned"]]

    # Augment committee data — if finance has no name, use LLM's for scoring
    llm_committee = llm.get("committee_name") or llm.get("paid_for_by")
    if llm_committee and not record.committee_mentions:
        record.committee_mentions = [llm_committee]
        if not finance.committee_name:
            finance.committee_name = llm_committee  # update in place for scoring

    # Re-score with augmented fields
    record.score = score_record(record, candidate, finance)
    record.confidence = confidence_from_score(record.score)
    record.rationale = build_rationale(record, candidate, finance)
    return record


# ---------------------------------------------------------------------------
# Phase 5 — Persist
# ---------------------------------------------------------------------------

def _record_to_dict(record: EvidenceRecord) -> dict:
    return {
        "url": record.url,
        "title": record.title,
        "h1": record.h1,
        "source_type": record.source_type,
        "score": record.score,
        "confidence": record.confidence,
        "rationale": record.rationale,
        "emails": record.emails,
        "phones": record.phones,
        "committee_mentions": record.committee_mentions,
        "office_phrases": record.office_phrases[:3],
        "outbound_social_links": record.outbound_social_links,
        "llm_extraction": record.llm_extraction,
        "fetched_at": record.fetched_at,
        "http_status": record.http_status,
    }


def persist_discovery(
    supabase,
    candidate: ThinCandidate,
    finance: FinanceData,
    scored: list[EvidenceRecord],
    dry_run: bool = False,
) -> None:
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    top = sorted(scored, key=lambda r: r.score, reverse=True)[:MAX_EVIDENCE_STORED]
    best = top[0] if top else None

    discovery_payload = {
        "best_match": _record_to_dict(best) if best else None,
        "all_candidates": [_record_to_dict(r) for r in top],
        "finance_data": {
            "committee_name": finance.committee_name,
            "treasurer_name": finance.treasurer_name,
            "address": finance.address,
        },
        "run_at": now_iso,
    }

    # Populate social_inference_text so enrich_candidates.py continues to work
    # without modification. Only use medium/high confidence matches.
    social_text: Optional[str] = None
    if best and best.body_text and best.confidence in ("high", "medium"):
        header = f"[Source: {best.url} | Confidence: {best.confidence} | Score: {best.score}]\n"
        social_text = (header + best.body_text)[:MAX_SOCIAL_TEXT_CHARS]

    if dry_run:
        if best:
            log.info(
                f"  [DRY RUN] best_score={best.score:.2f} "
                f"confidence={best.confidence} url={best.url[:70]}"
            )
        else:
            log.info("  [DRY RUN] No pages scored above threshold")
        return

    supabase.table("candidate_enrichment").upsert(
        {
            "candidate_id": candidate.candidate_id,
            "discovery_evidence": json.dumps(discovery_payload),
            "discovery_run_at": now_iso,
            "social_inference_text": social_text,
            "social_scraped_at": now_iso,
        },
        on_conflict="candidate_id",
    ).execute()


# ---------------------------------------------------------------------------
# Per-candidate orchestration
# ---------------------------------------------------------------------------

def process_candidate(
    candidate: ThinCandidate,
    serper_key: Optional[str],
    brave_key: Optional[str],
    backend,
) -> dict:
    log.info(
        f"Processing: {candidate.full_name} "
        f"({candidate.office_name}, {candidate.jurisdiction})"
    )

    # Phase 1 — Campaign Finance DB
    finance = fetch_finance_data(candidate)

    # Phase 2 — URL seeds
    seeds = collect_seed_urls(candidate, finance, serper_key, brave_key)

    # Phase 3 — Fetch, extract, score
    scored: list[EvidenceRecord] = []
    for seed in seeds:
        record = fetch_and_extract(seed, candidate)
        if not record:
            continue

        record.score = score_record(record, candidate, finance)
        record.confidence = confidence_from_score(record.score)
        record.rationale = build_rationale(record, candidate, finance)

        if record.score < MIN_SCORE_TO_STORE:
            log.info(
                f"  [drop score={record.score:.2f}] {record.url[:80]}"
                + (f" | {record.rationale[:80]}" if record.rationale else "")
            )
            continue

        log.info(
            f"  [{record.source_type}] score={record.score:.2f} "
            f"conf={record.confidence} {record.url[:80]}"
            f"\n    rationale: {record.rationale[:120]}"
        )
        scored.append(record)

        if record.confidence == "high":
            log.info(f"  High-confidence match: {record.url}")
            # Don't break — continue collecting for corroboration up to MAX_EVIDENCE_STORED.
            # Stopping early has caused missed pages that would have raised medium→high.

        if len(scored) >= MAX_EVIDENCE_STORED * 3:
            # Safety cap — avoid fetching indefinitely on very large seed sets
            break

    # Phase 4 — LLM extraction on medium-confidence pages only
    for record in scored:
        if record.confidence == "medium":
            log.debug(f"  LLM extraction: {record.url[:60]}")
            llm_fields = llm_extract_fields(record, candidate, backend)
            if llm_fields:
                apply_llm_fields(record, llm_fields, candidate, finance)

    scored.sort(key=lambda r: r.score, reverse=True)
    best = scored[0] if scored else None

    log.info(
        f"  → {len(scored)} pages scored. "
        f"Best: score={best.score:.2f} confidence={best.confidence}"
        + (f" | {best.url[:60]}" if best else "")
        if best else f"  → No pages scored above threshold"
    )

    return {
        "scored": scored,
        "finance": finance,
        "found": best is not None and best.confidence in ("high", "medium"),
    }


# ---------------------------------------------------------------------------
# Candidate DB fetch
# ---------------------------------------------------------------------------

def fetch_thin_candidates(supabase, limit: Optional[int] = None) -> list[ThinCandidate]:
    rows = (
        supabase.table("candidates")
        .select(
            "id, full_name, campaign_website_url, "
            "contests(offices(name), jurisdictions(name), district_name)"
        )
        .lt("completeness_score", THIN_THRESHOLD)
        .execute()
        .data
    )

    results: list[ThinCandidate] = []
    for c in rows:
        contest = c.get("contests") or {}
        office_name = (contest.get("offices") or {}).get("name", "Unknown Office")
        jurisdiction = (contest.get("jurisdictions") or {}).get("name", "Unknown Jurisdiction")
        results.append(
            ThinCandidate(
                candidate_id=c["id"],
                full_name=c["full_name"],
                office_name=office_name,
                jurisdiction=jurisdiction,
                district_name=contest.get("district_name"),
                campaign_website_url=c.get("campaign_website_url"),
            )
        )

    if limit:
        results = results[:limit]
    return results


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def discover_thin_candidates(
    backend_name: str = "lmstudio",
    limit: Optional[int] = None,
    dry_run: bool = False,
) -> dict[str, int]:
    from pipeline.enrich_candidates import make_backend

    serper_key = os.environ.get("SERPER_API_KEY")
    brave_key = os.environ.get("BRAVE_SEARCH_API_KEY")
    if not serper_key and not brave_key:
        log.error("Neither SERPER_API_KEY nor BRAVE_SEARCH_API_KEY is set in .env — aborting")
        sys.exit(1)
    if serper_key:
        log.info("Search provider: Serper (Google)" + (" + Brave fallback" if brave_key else ""))
    else:
        log.info("Search provider: Brave only (set SERPER_API_KEY to use Google as primary)")

    backend = make_backend(backend_name)
    supabase = get_client()

    candidates = fetch_thin_candidates(supabase, limit=limit)
    log.info(f"Found {len(candidates)} thin candidates to process")

    found = 0
    not_found = 0
    errors = 0

    for candidate in candidates:
        try:
            result = process_candidate(candidate, serper_key, brave_key, backend)
            persist_discovery(
                supabase,
                candidate,
                result["finance"],
                result["scored"],
                dry_run=dry_run,
            )
            if result["found"]:
                found += 1
            else:
                not_found += 1
        except Exception as exc:
            log.error(f"Error processing {candidate.full_name}: {exc}", exc_info=True)
            errors += 1

    if not dry_run:
        supabase.table("pipeline_runs").insert(
            {
                "script_name": "discover_thin_candidates.py",
                "candidates_processed": found + not_found,
                "errors": errors,
                "notes": (
                    f"backend={backend_name} "
                    f"found={found} not_found={not_found} "
                    f"dry_run={dry_run}"
                ),
            }
        ).execute()

    log.info(f"Done. found={found} not_found={not_found} errors={errors}")
    return {"found": found, "not_found": not_found, "errors": errors}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Discovery pipeline for thin-data candidates."
    )
    parser.add_argument(
        "--backend",
        choices=["lmstudio", "gemini", "openrouter"],
        default="lmstudio",
        help="AI backend for Phase 4 LLM extraction (default: lmstudio)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Process only the first N thin candidates",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Search and score without writing to the database",
    )
    args = parser.parse_args()

    log.info(
        f"=== discover_thin_candidates.py  backend={args.backend}  "
        f"dry_run={args.dry_run} ==="
    )
    try:
        result = discover_thin_candidates(
            backend_name=args.backend,
            limit=args.limit,
            dry_run=args.dry_run,
        )
        log.info("Next: run enrich_candidates.py to generate summaries from discovery results.")
        sys.exit(0)
    except Exception as exc:
        log.error(f"Fatal error: {exc}")
        raise
