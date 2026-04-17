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

import argparse
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
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

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

# Max pages to crawl per candidate domain (homepage + internal links)
MAX_PAGES_PER_SITE = 5

# File extensions to skip — not text content
SKIP_EXTENSIONS = {
    ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp",
    ".mp4", ".mp3", ".zip", ".doc", ".docx", ".xls", ".xlsx",
    ".css", ".js", ".ico", ".woff", ".woff2", ".ttf",
}

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



def extract_internal_links(base_url: str, html: str) -> list[str]:
    """Return all internal links found in html, normalized and deduplicated."""
    parsed_base = urlparse(base_url)
    base_origin = f"{parsed_base.scheme}://{parsed_base.netloc}"
    soup = BeautifulSoup(html, "lxml")

    seen: set[str] = set()
    links: list[str] = []

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        full = urljoin(base_url, href)
        parsed = urlparse(full)

        # Same domain only
        if parsed.netloc != parsed_base.netloc:
            continue
        # Skip non-http schemes (mailto:, tel:, javascript:, etc.)
        if parsed.scheme not in ("http", "https"):
            continue
        # Skip files that aren't HTML pages
        ext = parsed.path.lower().rsplit(".", 1)[-1] if "." in parsed.path else ""
        if f".{ext}" in SKIP_EXTENSIONS:
            continue

        # Normalize: strip fragment and query string, trailing slash
        clean = f"{base_origin}{parsed.path}".rstrip("/") or base_origin
        if clean in seen:
            continue
        seen.add(clean)
        links.append(clean)

    return links


def fetch_page(url: str) -> tuple[Optional[str], Optional[str]]:
    """
    Fetch a single URL. Returns (html, error_note).
    Tries requests first; falls back to Playwright.
    """
    req_error = None
    try:
        resp = requests.get(
            url,
            timeout=FAST_PATH_TIMEOUT,
            headers={"User-Agent": USER_AGENT},
            allow_redirects=True,
        )
        resp.raise_for_status()
        return resp.text, None
    except Exception as exc:
        req_error = type(exc).__name__

    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                page = browser.new_page(user_agent=USER_AGENT)
                page.goto(url, timeout=PLAYWRIGHT_TIMEOUT_MS, wait_until="domcontentloaded")
                try:
                    page.wait_for_load_state("networkidle", timeout=8000)
                except Exception:
                    pass
                return page.content(), None
            finally:
                browser.close()
    except Exception as exc:
        return None, f"requests:{req_error};playwright:{type(exc).__name__}"


def crawl_domain(start_url: str) -> tuple[Optional[str], str, int]:
    """
    BFS crawl of a candidate's domain starting from start_url.
    Visits up to MAX_PAGES_PER_SITE pages, combining all extracted text.
    Returns (combined_text, method_note, pages_scraped).
    """
    parsed_base = urlparse(start_url)
    base_origin = f"{parsed_base.scheme}://{parsed_base.netloc}"

    queue: list[str] = [start_url.rstrip("/") or base_origin]
    visited: set[str] = set()
    all_text: list[str] = []
    pages_scraped = 0

    while queue and pages_scraped < MAX_PAGES_PER_SITE:
        url = queue.pop(0)
        if url in visited:
            continue
        visited.add(url)

        html, err = fetch_page(url)
        if not html:
            continue

        text = extract_text_from_html(html)
        if text and len(text) >= MIN_TEXT_LENGTH:
            all_text.append(f"[Page: {url}]\n{text}")
            pages_scraped += 1

        # Discover new internal links from this page and add to queue
        for link in extract_internal_links(url, html):
            if link not in visited and link not in queue:
                queue.append(link)

    if not all_text:
        return None, "no_content", 0

    combined = truncate_text("\n\n".join(all_text))
    return combined, "crawl", pages_scraped


def scrape_one(target: CandidateWebsiteTarget) -> ScrapeResult:
    url = target.campaign_website_url.strip()
    if not url:
        return ScrapeResult(target.id, None, None, True, "empty_url")

    text, method, pages = crawl_domain(url)
    if text and len(text) >= MIN_TEXT_LENGTH:
        return ScrapeResult(target.id, method, text, False, f"pages={pages}")

    return ScrapeResult(target.id, None, None, True, f"no_content_after_crawl pages={pages}")


def fetch_targets(supabase, force: bool = False) -> list[CandidateWebsiteTarget]:
    candidates = supabase.table("candidates").select(
        "id, full_name, campaign_website_url"
    ).not_.is_("campaign_website_url", "null").execute().data

    if force:
        return [
            CandidateWebsiteTarget(
                id=row["id"],
                full_name=row["full_name"],
                campaign_website_url=row["campaign_website_url"],
            )
            for row in candidates
        ]

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


def scrape_candidate_websites(force: bool = False) -> dict[str, int]:
    supabase = get_client()
    targets = fetch_targets(supabase, force=force)
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

            try:
                persist_result(supabase, result)
            except Exception as exc:
                log.error(f"DB write error for {target.full_name}: {exc}")
                errors += 1
                continue

            processed += 1

            if result.scrape_error:
                errors += 1
                log.warning(f"Scrape issue for {target.full_name}: {result.notes}")
            else:
                text_length = len(result.text or "")
                log.info(
                    f"Scraped {target.full_name} — {result.notes}, {text_length} chars"
                )

    log_pipeline_run(supabase, processed, errors)
    return {"candidates_processed": processed, "errors": errors}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape candidate campaign websites.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-scrape all candidates, including those already scraped successfully.",
    )
    args = parser.parse_args()

    log.info(f"=== scrape_candidate_websites.py  force={args.force} ===")
    try:
        summary = scrape_candidate_websites(force=args.force)
        log.info(f"Done. Summary: {summary}")
        sys.exit(0)
    except Exception as exc:
        log.error(f"Fatal error: {exc}")
        raise
