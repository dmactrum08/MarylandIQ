"""
scrape_social_media.py

Scrapes social media profiles and news articles for candidates using links
already stored in the database. No discovery or LLM validation — all social
URLs were pre-populated via the CSV import pipeline.

Sources scraped per candidate (Tier 1 only):
    facebook_url, twitter_handle, threads_url, instagram_url, linkedin_url,
    news_article_urls (up to MAX_ARTICLE_SCRAPE)

Results stored in candidate_enrichment.social_inference_text.

Usage:
    python -m pipeline.scrape_social_media
    python -m pipeline.scrape_social_media --force   # re-scrape everyone
    python -m pipeline.scrape_social_media --limit 50
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
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

# Rate limit between individual social page scrapes
SCRAPE_SLEEP = 1.0

MAX_SOCIAL_TEXT_CHARS = 10000  # per candidate — fed into social_inference_text

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
    instagram_url: Optional[str]
    threads_url: Optional[str]
    news_article_urls: list


@dataclass
class SocialResult:
    candidate_id: str
    social_text: Optional[str]
    notes: str


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def fetch_thin_candidates(
    supabase, limit: Optional[int] = None, force: bool = False,
    candidate_name: Optional[str] = None,
) -> list[ThinCandidate]:
    """
    Return candidates to scrape social media for.

    Normal mode: only candidates with completeness_score < THIN_THRESHOLD that
    haven't been successfully scraped yet (or whose null result is stale).

    Force mode (--force): all candidates regardless of score or prior scrape state.
    """
    query = supabase.table("candidates").select(
        "id, full_name, facebook_url, twitter_handle, linkedin_url, "
        "instagram_url, threads_url, "
        "contests(offices(name), jurisdictions(name)), "
        "news_article_urls, "
        "candidate_enrichment(social_scraped_at, social_inference_text)"
    )
    if candidate_name:
        query = query.ilike("full_name", f"%{candidate_name}%")
        force = True  # always re-scrape when targeting a specific candidate
    elif not force:
        query = query.lt("completeness_score", THIN_THRESHOLD)
    rows = query.execute().data

    results: list[ThinCandidate] = []
    retry_cutoff = datetime.now(timezone.utc) - timedelta(days=NULL_RESULT_RETRY_DAYS)

    for c in rows:
        enr = c.get("candidate_enrichment") or {}
        if isinstance(enr, list):
            enr = enr[0] if enr else {}

        if not force:
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
                instagram_url=c.get("instagram_url"),
                threads_url=c.get("threads_url"),
                news_article_urls=c.get("news_article_urls") or [],
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
# Scraping
# ---------------------------------------------------------------------------

# How many news articles to scrape per candidate in Tier 1
MAX_ARTICLE_SCRAPE = 3


def run_tier1(candidate: ThinCandidate) -> tuple[Optional[str], Optional[str]]:
    """
    Scrape existing social links and news articles from the DB.
    Returns (combined_text, facebook_url_used).
    """
    chunks: list[str] = []
    fb_url_used: Optional[str] = None

    if candidate.facebook_url:
        time.sleep(SCRAPE_SLEEP)
        text = scrape_url(candidate.facebook_url)
        if text:
            chunks.append(f"[Facebook]\n{text}")
            fb_url_used = candidate.facebook_url

    if candidate.twitter_handle:
        time.sleep(SCRAPE_SLEEP)
        tw_url = (
            candidate.twitter_handle
            if candidate.twitter_handle.startswith("http")
            else f"https://x.com/{candidate.twitter_handle.lstrip('@')}"
        )
        text = scrape_url(tw_url)
        if text:
            chunks.append(f"[Twitter/X]\n{text}")

    if candidate.threads_url:
        time.sleep(SCRAPE_SLEEP)
        text = scrape_url(candidate.threads_url)
        if text:
            chunks.append(f"[Threads]\n{text}")

    if candidate.instagram_url:
        time.sleep(SCRAPE_SLEEP)
        text = scrape_url(candidate.instagram_url)
        if text:
            chunks.append(f"[Instagram]\n{text}")

    if candidate.linkedin_url:
        time.sleep(SCRAPE_SLEEP)
        text = scrape_url(candidate.linkedin_url)
        if text:
            chunks.append(f"[LinkedIn]\n{text}")

    for article_url in candidate.news_article_urls[:MAX_ARTICLE_SCRAPE]:
        time.sleep(SCRAPE_SLEEP)
        text = scrape_url(article_url)
        if text:
            chunks.append(f"[News Article: {article_url}]\n{text}")

    combined = "\n\n".join(chunks)[:MAX_SOCIAL_TEXT_CHARS] if chunks else None
    return combined, fb_url_used


# ---------------------------------------------------------------------------
# Main processing
# ---------------------------------------------------------------------------

def process_candidate(candidate: ThinCandidate) -> SocialResult:
    log.info(f"Processing: {candidate.full_name} ({candidate.office_name}, {candidate.jurisdiction})")
    social_text, _ = run_tier1(candidate)
    return SocialResult(
        candidate_id=candidate.candidate_id,
        social_text=social_text,
        notes="scraped" if social_text else "no_content",
    )


def scrape_social_media(
    limit: Optional[int] = None, force: bool = False,
    candidate_name: Optional[str] = None,
    max_chars: Optional[int] = None,
) -> dict[str, int]:
    global MAX_SOCIAL_TEXT_CHARS
    if max_chars is not None:
        MAX_SOCIAL_TEXT_CHARS = max_chars

    supabase = get_client()
    candidates = fetch_thin_candidates(supabase, limit=limit, force=force, candidate_name=candidate_name)
    log.info(f"Found {len(candidates)} candidates to scrape")

    found = 0
    not_found = 0
    errors = 0

    for candidate in candidates:
        try:
            result = process_candidate(candidate)
            persist_result(supabase, result)
            if result.social_text:
                found += 1
                log.info(f"  → {len(result.social_text)} chars stored")
            else:
                not_found += 1
                log.info(f"  → No content found")
        except Exception as exc:
            log.error(f"Error processing {candidate.full_name}: {exc}", exc_info=True)
            errors += 1

    supabase.table("pipeline_runs").insert(
        {
            "script_name": "scrape_social_media.py",
            "candidates_processed": found + not_found,
            "errors": errors,
            "notes": f"found={found} not_found={not_found}",
        }
    ).execute()

    return {"found": found, "not_found": not_found, "errors": errors}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape social media and articles for all candidates.")
    parser.add_argument("--limit", type=int, default=None, metavar="N",
                        help="Process only the first N candidates")
    parser.add_argument("--force", action="store_true",
                        help="Re-scrape all candidates regardless of prior scrape state")
    parser.add_argument("--candidate", type=str, default=None, metavar="NAME",
                        help="Scrape a single candidate by name (case-insensitive substring match). Implies --force for that candidate.")
    parser.add_argument("--max-chars", type=int, default=None, metavar="N",
                        help=f"Override the per-candidate text character limit (default {MAX_SOCIAL_TEXT_CHARS}).")
    args = parser.parse_args()

    log.info("=== scrape_social_media.py ===")
    try:
        result = scrape_social_media(limit=args.limit, force=args.force, candidate_name=args.candidate, max_chars=args.max_chars)
        log.info(f"Done. {result}")
        sys.exit(0)
    except Exception as exc:
        log.error(f"Fatal error: {exc}")
        raise
