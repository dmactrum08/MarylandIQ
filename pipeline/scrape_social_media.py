"""
scrape_social_media.py

Stage 2 script — three-tier social media inference pipeline for thin candidates
(completeness_score < 40).

Tier 1: Follow existing social links already in candidates.facebook_url,
        twitter_handle, linkedin_url. Scrape public content directly.

Tier 2: DuckDuckGo search for Facebook pages using name + office + jurisdiction.
        Never name alone. Facebook first; Twitter conserved due to 500-read/month
        API quota; no LinkedIn name search (too many false matches).

Tier 3: LLM validation gate before storing any Tier 2 result.
        YES → store. NO or UNCERTAIN → discard (null). False match is worse than blank.

After running, re-run enrich_candidates.py — it already handles social_inference_text.

Usage:
    python -m pipeline.scrape_social_media                  # LM Studio (default)
    python -m pipeline.scrape_social_media --backend gemini
    python -m pipeline.scrape_social_media --limit 50       # process first N candidates
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from html import unescape
from typing import Optional

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

# Completeness threshold — only process candidates below this score
THIN_THRESHOLD = 40

# Rate limits — social sites are more aggressive than campaign websites
DDG_SEARCH_SLEEP = 3.0       # seconds between DuckDuckGo searches
TIER1_SCRAPE_SLEEP = 1.0     # seconds between individual social page scrapes
MAX_SOCIAL_TEXT_CHARS = 4000  # per candidate — fed into social_inference_text

# Max DDG results to validate per candidate (Tier 2)
MAX_DDG_RESULTS = 3

# Minimum text length to consider a social scrape successful
MIN_USEFUL_TEXT = 100

# Re-attempt candidates with no verified social text after this many days.
# Successful captures remain cached and are not retried automatically.
NULL_RESULT_RETRY_DAYS = 14

# Phrases indicating we hit a login wall rather than actual content
LOGIN_WALL_PHRASES = [
    "log in to facebook",
    "you must log in",
    "sign in to twitter",
    "join linkedin",
    "sign up to see",
    "create an account",
]

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

VALIDATION_SYSTEM_PROMPT = (
    "You are a data validator for a nonpartisan voter information platform. "
    "Determine whether a social media profile belongs to a specific political candidate. "
    "Answer only: YES, NO, or UNCERTAIN. No explanation. No other output."
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
    facebook_url: Optional[str]
    twitter_handle: Optional[str]
    linkedin_url: Optional[str]


@dataclass
class SocialResult:
    candidate_id: str
    social_text: Optional[str]
    discovered_facebook_url: Optional[str]  # set only if Tier 2 finds a new Facebook URL
    discovered_linkedin_url: Optional[str]  # set only if Tier 2 finds a new LinkedIn URL
    tier: Optional[int]                     # 1, 2, or None
    notes: str


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def fetch_thin_candidates(supabase, limit: Optional[int] = None) -> list[ThinCandidate]:
    """
    Return candidates with completeness_score < THIN_THRESHOLD whose
    social_scraped_at is not yet set.
    """
    rows = (
        supabase.table("candidates")
        .select(
            "id, full_name, facebook_url, twitter_handle, linkedin_url, "
            "contests(offices(name), jurisdictions(name)), "
            "candidate_enrichment(social_scraped_at)"
        )
        .lt("completeness_score", THIN_THRESHOLD)
        .execute()
        .data
    )

    results: list[ThinCandidate] = []
    retry_cutoff = datetime.now(timezone.utc) - timedelta(days=NULL_RESULT_RETRY_DAYS)
    for c in rows:
        # Normalise the enrichment embed (PostgREST may return list or dict)
        enr = c.get("candidate_enrichment") or {}
        if isinstance(enr, list):
            enr = enr[0] if enr else {}

        social_text = enr.get("social_inference_text")
        if social_text:
            continue  # already have verified social content cached

        scraped_at = enr.get("social_scraped_at")
        if scraped_at:
            try:
                parsed = datetime.fromisoformat(scraped_at.replace("Z", "+00:00"))
            except ValueError:
                log.warning(
                    f"Could not parse social_scraped_at for {c.get('full_name', 'unknown')}: "
                    f"{scraped_at!r}; retrying candidate."
                )
            else:
                if parsed > retry_cutoff:
                    continue  # recent null result; wait before retrying

        contest = c.get("contests") or {}
        office_name = (contest.get("offices") or {}).get("name", "Unknown Office")
        jurisdiction = (contest.get("jurisdictions") or {}).get("name", "Unknown Jurisdiction")

        results.append(
            ThinCandidate(
                candidate_id=c["id"],
                full_name=c["full_name"],
                office_name=office_name,
                jurisdiction=jurisdiction,
                facebook_url=c.get("facebook_url"),
                twitter_handle=c.get("twitter_handle"),
                linkedin_url=c.get("linkedin_url"),
            )
        )

    if limit:
        results = results[:limit]

    return results


def persist_result(supabase, result: SocialResult) -> None:
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    supabase.table("candidate_enrichment").upsert(
        {
            "candidate_id": result.candidate_id,
            "social_inference_text": result.social_text,
            "social_scraped_at": now_iso,
        },
        on_conflict="candidate_id",
    ).execute()

    # Write back any Tier 2 discovered URLs to the candidates table
    if result.tier == 2:
        updates: dict = {}
        if result.discovered_facebook_url:
            updates["facebook_url"] = result.discovered_facebook_url
        if result.discovered_linkedin_url:
            updates["linkedin_url"] = result.discovered_linkedin_url
        if updates:
            supabase.table("candidates").update(updates).eq(
                "id", result.candidate_id
            ).execute()


# ---------------------------------------------------------------------------
# Scraping helpers
# ---------------------------------------------------------------------------

def _extract_text(html: str) -> Optional[str]:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()
    text = unescape(" ".join(soup.get_text(" ", strip=True).split()))
    return text[:MAX_SOCIAL_TEXT_CHARS] if text else None


def _is_login_wall(text: str) -> bool:
    lower = text.lower()
    return any(phrase in lower for phrase in LOGIN_WALL_PHRASES)


def scrape_url_requests(url: str) -> Optional[str]:
    try:
        resp = requests.get(
            url,
            timeout=10,
            headers={"User-Agent": USER_AGENT},
            allow_redirects=True,
        )
        resp.raise_for_status()
        text = _extract_text(resp.text)
        if text and len(text) >= MIN_USEFUL_TEXT and not _is_login_wall(text):
            return text
        return None
    except Exception:
        return None


def scrape_url_playwright(url: str) -> Optional[str]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                page = browser.new_page(user_agent=USER_AGENT)
                page.goto(url, timeout=15_000, wait_until="domcontentloaded")
                try:
                    page.wait_for_load_state("networkidle", timeout=8_000)
                except Exception:
                    pass  # timeout on networkidle is fine; use what we have
                text = _extract_text(page.content())
                if text and len(text) >= MIN_USEFUL_TEXT and not _is_login_wall(text):
                    return text
                return None
            finally:
                browser.close()
    except Exception:
        return None


def scrape_url(url: str) -> Optional[str]:
    """Try requests first; fall back to Playwright."""
    text = scrape_url_requests(url)
    if text:
        return text
    return scrape_url_playwright(url)


# ---------------------------------------------------------------------------
# DuckDuckGo search
# ---------------------------------------------------------------------------

def _search_duckduckgo(query: str, domain_filter: str) -> list[str]:
    """
    Run a DuckDuckGo HTML search and return URLs containing domain_filter.
    Internal helper — always sleeps DDG_SEARCH_SLEEP before the request.
    """
    encoded = urllib.parse.urlencode({"q": query})
    time.sleep(DDG_SEARCH_SLEEP)
    try:
        resp = requests.get(
            f"https://html.duckduckgo.com/html/?{encoded}",
            headers={
                "User-Agent": USER_AGENT,
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=15,
        )
        resp.raise_for_status()
    except Exception as exc:
        log.warning(f"DuckDuckGo search failed ({query[:60]!r}): {exc}")
        return []

    soup = BeautifulSoup(resp.text, "lxml")
    urls: list[str] = []
    for a in soup.select("a.result__a"):
        href = a.get("href", "")
        if domain_filter in href:
            urls.append(href)
        elif "uddg=" in href:
            parsed = urllib.parse.urlparse(href)
            qs = urllib.parse.parse_qs(parsed.query)
            if "uddg" in qs:
                actual = urllib.parse.unquote(qs["uddg"][0])
                if domain_filter in actual:
                    urls.append(actual)
        if len(urls) >= MAX_DDG_RESULTS:
            break
    return urls


def search_duckduckgo_facebook(name: str, office: str, jurisdiction: str) -> list[str]:
    """
    Search DuckDuckGo for Facebook pages matching this candidate.
    Uses name + office + jurisdiction — never name alone.
    """
    query = f'site:facebook.com "{name}" "{office}" "{jurisdiction}" Maryland'
    return _search_duckduckgo(query, "facebook.com")


def search_duckduckgo_linkedin(name: str, office: str, jurisdiction: str) -> list[str]:
    """
    Search DuckDuckGo for LinkedIn profiles matching this candidate.
    Restricts to /in/ profiles to avoid company/school pages.
    """
    query = f'site:linkedin.com/in "{name}" "{office}" "{jurisdiction}" Maryland'
    return _search_duckduckgo(query, "linkedin.com/in")


# ---------------------------------------------------------------------------
# LLM validation (Tier 3)
# ---------------------------------------------------------------------------

def validate_profile(candidate: ThinCandidate, profile_text: str, backend) -> bool:
    """
    Ask the LLM whether profile_text clearly belongs to this candidate.
    Returns True only on YES. UNCERTAIN → False (safe default).
    """
    snippet = profile_text[:1200]
    prompt = (
        f"Candidate on file: {candidate.full_name}, running for "
        f"{candidate.office_name} in {candidate.jurisdiction}, Maryland, 2026 election.\n\n"
        f"Social profile content:\n{snippet}\n\n"
        f"Does this social profile clearly belong to this specific candidate "
        f"running for this specific office?\n"
        f"Answer only: YES, NO, or UNCERTAIN."
    )

    try:
        raw = backend.call(prompt, system_prompt=VALIDATION_SYSTEM_PROMPT).strip()
        backend.sleep_between_calls()
    except Exception as exc:
        log.warning(f"LLM validation error for {candidate.full_name}: {exc}")
        return False

    # Extract the first word in case the model adds explanation despite instructions
    first_word = raw.upper().split()[0] if raw.split() else ""
    if first_word == "YES":
        log.debug(f"Validation YES for {candidate.full_name}")
        return True
    log.debug(f"Validation {first_word!r} for {candidate.full_name} — discarding")
    return False


# ---------------------------------------------------------------------------
# Tier processing
# ---------------------------------------------------------------------------

def run_tier1(candidate: ThinCandidate) -> tuple[Optional[str], Optional[str]]:
    """
    Scrape existing social links from the DB.
    Returns (combined_text, facebook_url_used).
    """
    chunks: list[str] = []
    fb_url_used: Optional[str] = None

    if candidate.facebook_url:
        time.sleep(TIER1_SCRAPE_SLEEP)
        text = scrape_url(candidate.facebook_url)
        if text:
            chunks.append(f"[Facebook]\n{text}")
            fb_url_used = candidate.facebook_url

    if candidate.twitter_handle:
        time.sleep(TIER1_SCRAPE_SLEEP)
        handle = candidate.twitter_handle.lstrip("@")
        text = scrape_url(f"https://x.com/{handle}")
        if text:
            chunks.append(f"[Twitter/X]\n{text}")

    if candidate.linkedin_url:
        time.sleep(TIER1_SCRAPE_SLEEP)
        text = scrape_url(candidate.linkedin_url)
        if text:
            chunks.append(f"[LinkedIn]\n{text}")

    combined = "\n\n".join(chunks)[:MAX_SOCIAL_TEXT_CHARS] if chunks else None
    return combined, fb_url_used


def run_tier2(
    candidate: ThinCandidate, backend
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """
    DuckDuckGo search (Facebook first, then LinkedIn) + LLM validation.
    Returns (social_text, discovered_facebook_url, discovered_linkedin_url).
    """
    # Facebook search
    fb_urls = search_duckduckgo_facebook(
        candidate.full_name, candidate.office_name, candidate.jurisdiction
    )
    for url in fb_urls:
        time.sleep(TIER1_SCRAPE_SLEEP)
        text = scrape_url(url)
        if not text:
            continue
        if validate_profile(candidate, text, backend):
            log.info(f"  Tier 2 Facebook validated: {url}")
            return text[:MAX_SOCIAL_TEXT_CHARS], url, None

    # LinkedIn search — useful for political/professional bios
    li_urls = search_duckduckgo_linkedin(
        candidate.full_name, candidate.office_name, candidate.jurisdiction
    )
    for url in li_urls:
        time.sleep(TIER1_SCRAPE_SLEEP)
        text = scrape_url(url)
        if not text:
            continue
        if validate_profile(candidate, text, backend):
            log.info(f"  Tier 2 LinkedIn validated: {url}")
            return text[:MAX_SOCIAL_TEXT_CHARS], None, url

    return None, None, None


# ---------------------------------------------------------------------------
# Main processing
# ---------------------------------------------------------------------------

def process_candidate(candidate: ThinCandidate, backend) -> SocialResult:
    log.info(
        f"Processing: {candidate.full_name} "
        f"({candidate.office_name}, {candidate.jurisdiction})"
    )

    # Tier 1 — follow existing links
    social_text, fb_url = run_tier1(candidate)
    if social_text:
        return SocialResult(
            candidate_id=candidate.candidate_id,
            social_text=social_text,
            discovered_facebook_url=None,  # URL was already in DB
            discovered_linkedin_url=None,
            tier=1,
            notes="tier1_existing_links",
        )

    # Tier 2+3 — search and validate
    social_text, disc_fb, disc_li = run_tier2(candidate, backend)
    if social_text:
        return SocialResult(
            candidate_id=candidate.candidate_id,
            social_text=social_text,
            discovered_facebook_url=disc_fb,
            discovered_linkedin_url=disc_li,
            tier=2,
            notes="tier2_search_validated",
        )

    return SocialResult(
        candidate_id=candidate.candidate_id,
        social_text=None,
        discovered_facebook_url=None,
        discovered_linkedin_url=None,
        tier=None,
        notes="no_social_found",
    )


def scrape_social_media(
    backend_name: str = "lmstudio",
    limit: Optional[int] = None,
) -> dict[str, int]:
    # Import the backend factory from enrich_candidates to avoid duplication
    from pipeline.enrich_candidates import make_backend

    backend = make_backend(backend_name)
    supabase = get_client()

    candidates = fetch_thin_candidates(supabase, limit=limit)
    log.info(f"Found {len(candidates)} thin candidates to process")

    found = 0
    not_found = 0
    errors = 0

    for candidate in candidates:
        try:
            result = process_candidate(candidate, backend)
            persist_result(supabase, result)

            if result.social_text:
                found += 1
                log.info(f"  → Stored social text (tier={result.tier}, {len(result.social_text)} chars)")
            else:
                not_found += 1
                log.info(f"  → No verified social presence found")

        except Exception as exc:
            log.error(f"Error processing {candidate.full_name}: {exc}", exc_info=True)
            errors += 1

    supabase.table("pipeline_runs").insert(
        {
            "script_name": "scrape_social_media.py",
            "candidates_processed": found + not_found,
            "errors": errors,
            "notes": f"backend={backend_name} found={found} not_found={not_found}",
        }
    ).execute()

    return {"found": found, "not_found": not_found, "errors": errors}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Three-tier social inference pipeline for thin candidates."
    )
    parser.add_argument(
        "--backend",
        choices=["lmstudio", "gemini", "openrouter"],
        default="lmstudio",
        help="AI backend for Tier 3 validation (default: lmstudio)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Process only the first N thin candidates (useful for testing)",
    )
    args = parser.parse_args()

    log.info(f"=== scrape_social_media.py  backend={args.backend} ===")
    try:
        result = scrape_social_media(backend_name=args.backend, limit=args.limit)
        log.info(f"Done. {result}")
        log.info("Next: re-run enrich_candidates.py to generate summaries from new social text.")
        sys.exit(0)
    except Exception as exc:
        log.error(f"Fatal error: {exc}")
        raise
