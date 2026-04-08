"""
scrape_candidate_websites.py

Stage 2 script — scrape candidate campaign websites and cache raw text in
candidate_enrichment for later LLM enrichment.

Strategy:
    1. Fast path: requests + BeautifulSoup
    2. Fallback: Playwright for JS-rendered sites

This follows the implementation strategy's two-path design and keeps writes
idempotent by upserting candidate_enrichment rows per candidate.
"""

from __future__ import annotations

import concurrent.futures
import logging
import sys
import threading
import time
from dataclasses import dataclass
from html import unescape
from typing import Optional
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup

from pipeline.utils.supabase_client import get_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

FAST_PATH_TIMEOUT = 8
PLAYWRIGHT_TIMEOUT_MS = 15000
MAX_WORKERS = 5
MIN_TEXT_LENGTH = 300
MAX_TEXT_CHARS = 32000
USER_AGENT = "MarylandIQ/1.0 (public voter information platform)"

CONTENT_SELECTORS = [
    "main",
    "article",
    ".about",
    ".platform",
    ".issues",
    ".issues-section",
    ".entry-content",
    ".page-content",
    ".post-content",
]

ROBOTS_CACHE: dict[str, Optional[RobotFileParser]] = {}
ROBOTS_LOCK = threading.Lock()


@dataclass
class CandidateWebsiteTarget:
    id: str
    full_name: str
    campaign_website_url: str


@dataclass
class ScrapeResult:
    candidate_id: str
    method: Optional[str]
    text: Optional[str]
    scrape_error: bool
    notes: str


def normalize_whitespace(text: str) -> str:
    return " ".join(unescape(text).split())


def truncate_text(text: str) -> str:
    if len(text) <= MAX_TEXT_CHARS:
        return text
    return text[:MAX_TEXT_CHARS]


def check_robots_allowed(url: str) -> bool:
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return False

    base = f"{parsed.scheme}://{parsed.netloc}"
    with ROBOTS_LOCK:
        parser = ROBOTS_CACHE.get(base)
        if parser is None:
            robots_url = urljoin(base, "/robots.txt")
            parser = RobotFileParser()
            parser.set_url(robots_url)
            try:
                parser.read()
            except Exception:
                # If robots cannot be fetched, default to allow for MVP.
                parser = None
            ROBOTS_CACHE[base] = parser

    if parser is None:
        return True

    try:
        return parser.can_fetch(USER_AGENT, url)
    except Exception:
        return True


def extract_text_from_html(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")

    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()

    chunks: list[str] = []
    for selector in CONTENT_SELECTORS:
        for node in soup.select(selector):
            text = normalize_whitespace(node.get_text(" ", strip=True))
            if text:
                chunks.append(text)
        if chunks:
            break

    if not chunks and soup.body:
        body_text = normalize_whitespace(soup.body.get_text(" ", strip=True))
        if body_text:
            chunks.append(body_text)

    return truncate_text("\n\n".join(chunks).strip())


def scrape_with_requests(url: str) -> Optional[str]:
    response = requests.get(
        url,
        timeout=FAST_PATH_TIMEOUT,
        headers={"User-Agent": USER_AGENT},
        allow_redirects=True,
    )
    response.raise_for_status()
    return extract_text_from_html(response.text)


def scrape_with_playwright(url: str) -> Optional[str]:
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:
        raise RuntimeError(f"Playwright not available: {exc}") from exc

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page(user_agent=USER_AGENT)
            page.goto(url, timeout=PLAYWRIGHT_TIMEOUT_MS, wait_until="domcontentloaded")
            page.wait_for_load_state("networkidle", timeout=PLAYWRIGHT_TIMEOUT_MS)
            html = page.content()
            return extract_text_from_html(html)
        finally:
            browser.close()


def scrape_one(target: CandidateWebsiteTarget) -> ScrapeResult:
    url = target.campaign_website_url.strip()
    if not url:
        return ScrapeResult(target.id, None, None, True, "empty_url")

    if not check_robots_allowed(url):
        return ScrapeResult(target.id, None, None, True, "robots_disallowed")

    try:
        text = scrape_with_requests(url)
        if text and len(text) >= MIN_TEXT_LENGTH:
            return ScrapeResult(target.id, "requests", text, False, "ok")
    except Exception as exc:
        requests_error = f"requests_failed:{type(exc).__name__}"
    else:
        requests_error = "requests_too_short"

    try:
        text = scrape_with_playwright(url)
        if text and len(text) >= MIN_TEXT_LENGTH:
            return ScrapeResult(target.id, "playwright", text, False, "ok")
        return ScrapeResult(target.id, "playwright", text, True, "playwright_too_short")
    except Exception as exc:
        return ScrapeResult(target.id, None, None, True, f"{requests_error};playwright_failed:{type(exc).__name__}")


def fetch_targets(supabase) -> list[CandidateWebsiteTarget]:
    candidates = supabase.table("candidates").select(
        "id, full_name, campaign_website_url"
    ).not_.is_("campaign_website_url", "null").execute().data

    enrichment_rows = supabase.table("candidate_enrichment").select(
        "candidate_id, website_scraped_at, scrape_error"
    ).execute().data
    enrichment_by_candidate = {row["candidate_id"]: row for row in enrichment_rows}

    targets: list[CandidateWebsiteTarget] = []
    for row in candidates:
        enrichment = enrichment_by_candidate.get(row["id"])
        if enrichment and enrichment.get("website_scraped_at") and not enrichment.get("scrape_error"):
            continue
        targets.append(
            CandidateWebsiteTarget(
                id=row["id"],
                full_name=row["full_name"],
                campaign_website_url=row["campaign_website_url"],
            )
        )

    return targets


def persist_result(supabase, result: ScrapeResult) -> None:
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    supabase.table("candidate_enrichment").upsert(
        {
            "candidate_id": result.candidate_id,
            "scraped_website_text": result.text,
            "scrape_method": result.method,
            "scrape_error": result.scrape_error,
            "website_scraped_at": now_iso,
        },
        on_conflict="candidate_id",
    ).execute()

    supabase.table("candidates").update(
        {"last_scraped_at": now_iso}
    ).eq("id", result.candidate_id).execute()


def log_pipeline_run(supabase, processed: int, errors: int) -> None:
    supabase.table("pipeline_runs").insert(
        {
            "script_name": "scrape_candidate_websites.py",
            "candidates_processed": processed,
            "errors": errors,
        }
    ).execute()


def scrape_candidate_websites() -> dict[str, int]:
    supabase = get_client()
    targets = fetch_targets(supabase)
    log.info(f"Found {len(targets)} candidate websites to scrape")

    processed = 0
    errors = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_map = {executor.submit(scrape_one, target): target for target in targets}

        for future in concurrent.futures.as_completed(future_map):
            target = future_map[future]
            try:
                result = future.result()
            except Exception as exc:
                log.error(f"Unhandled scrape error for {target.full_name}: {exc}")
                errors += 1
                continue

            persist_result(supabase, result)
            processed += 1

            if result.scrape_error:
                errors += 1
                log.warning(f"Scrape issue for {target.full_name}: {result.notes}")
            else:
                text_length = len(result.text or "")
                log.info(
                    f"Scraped {target.full_name} via {result.method} ({text_length} chars)"
                )

    log_pipeline_run(supabase, processed, errors)
    return {"candidates_processed": processed, "errors": errors}


if __name__ == "__main__":
    log.info("=== scrape_candidate_websites.py ===")
    try:
        summary = scrape_candidate_websites()
        log.info(f"Done. Summary: {summary}")
        sys.exit(0)
    except Exception as exc:
        log.error(f"Fatal error: {exc}")
        raise
