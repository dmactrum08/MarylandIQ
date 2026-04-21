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

FAST_PATH_TIMEOUT = (5, 8)  # (connect, read) — prevents DNS hangs
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


MAX_ARTICLE_CHARS = 2000   # per article, before concatenation
MAX_ARTICLES = 5           # max articles to scrape per candidate

LOGIN_SIGNALS = [
    "subscribe to read", "sign in to read",
    "create a free account", "paywall", "subscribers only",
]


@dataclass
class CandidateWebsiteTarget:
    id: str
    full_name: str
    campaign_website_url: str
    news_article_urls: list[str]


@dataclass
class ScrapeResult:
    candidate_id: str
    method: Optional[str]
    text: Optional[str]
    scrape_error: bool
    notes: str
    news_text: Optional[str] = None
    news_scrape_error: bool = False


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


def _fetch_requests_only(url: str) -> tuple[Optional[str], Optional[str]]:
    """Requests-only fetch with no Playwright fallback. Used for probe pages."""
    try:
        resp = requests.get(url, timeout=FAST_PATH_TIMEOUT,
                            headers={"User-Agent": USER_AGENT}, allow_redirects=True)
        resp.raise_for_status()
        return resp.text, None
    except requests.exceptions.SSLError:
        try:
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            resp = requests.get(url, timeout=FAST_PATH_TIMEOUT,
                                headers={"User-Agent": USER_AGENT},
                                allow_redirects=True, verify=False)
            resp.raise_for_status()
            return resp.text, None
        except Exception:
            return None, "ssl_error"
    except Exception as exc:
        return None, type(exc).__name__


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
    except requests.exceptions.SSLError:
        # Retry with SSL verification disabled for self-signed certs
        try:
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            resp = requests.get(
                url,
                timeout=FAST_PATH_TIMEOUT,
                headers={"User-Agent": USER_AGENT},
                allow_redirects=True,
                verify=False,
            )
            resp.raise_for_status()
            return resp.text, None
        except Exception as exc:
            req_error = f"SSLError+{type(exc).__name__}"
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


# Common campaign page paths to probe when link discovery finds nothing
_PROBE_PATHS = [
    "/about", "/about-me", "/bio", "/biography", "/meet-me",
    "/issues", "/platform", "/priorities", "/positions",
    "/news", "/blog", "/press",
    "/contact", "/volunteer", "/events",
]


def _probe_common_pages(base_origin: str, visited: set[str]) -> list[str]:
    """Return probe URLs for common campaign paths not yet visited."""
    urls = []
    for path in _PROBE_PATHS:
        url = f"{base_origin}{path}"
        if url not in visited:
            urls.append(url)
    return urls


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
    probed = False
    probe_urls: set[str] = set()

    while queue and pages_scraped < MAX_PAGES_PER_SITE:
        url = queue.pop(0)
        if url in visited:
            continue
        visited.add(url)

        is_probe = url in probe_urls
        html, err = fetch_page(url) if not is_probe else _fetch_requests_only(url)
        if not html:
            continue

        text = extract_text_from_html(html)
        if text and len(text) >= MIN_TEXT_LENGTH:
            all_text.append(f"[Page: {url}]\n{text}")
            pages_scraped += 1

        # Discover new internal links from this page
        new_links = extract_internal_links(url, html)

        # If the homepage yields no links, the nav is JS-rendered — try
        # Playwright to get rendered HTML and re-extract links from it.
        if not new_links and url == (start_url.rstrip("/") or base_origin):
            try:
                from playwright.sync_api import sync_playwright
                with sync_playwright() as pw:
                    browser = pw.chromium.launch(headless=True)
                    try:
                        pg = browser.new_page(user_agent=USER_AGENT)
                        pg.goto(url, timeout=PLAYWRIGHT_TIMEOUT_MS, wait_until="domcontentloaded")
                        try:
                            pg.wait_for_load_state("networkidle", timeout=8000)
                        except Exception:
                            pass
                        rendered = pg.content()
                        new_links = extract_internal_links(url, rendered)
                    finally:
                        browser.close()
            except Exception:
                pass

        for link in new_links:
            if link not in visited and link not in queue:
                queue.append(link)

        # After exhausting discovered links, probe common paths once (requests-only)
        if not queue and not probed:
            probed = True
            for link in _probe_common_pages(base_origin, visited):
                probe_urls.add(link)
                queue.append(link)

    if not all_text:
        return None, "no_content", 0

    combined = truncate_text("\n\n".join(all_text))
    return combined, "crawl", pages_scraped


def scrape_article(url: str) -> Optional[str]:
    """Fetch plain text from a single news article URL. Returns None on failure or paywall."""
    try:
        resp = requests.get(
            url, timeout=FAST_PATH_TIMEOUT,
            headers={"User-Agent": USER_AGENT},
            allow_redirects=True,
        )
        resp.raise_for_status()
    except Exception as exc:
        log.debug("Article fetch failed for %s: %s", url, exc)
        return None

    soup = BeautifulSoup(resp.text, "lxml")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    content: Optional[str] = None
    for sel in ["article", "main", ".article-body", ".story-body", ".entry-content", ".post-content"]:
        node = soup.select_one(sel)
        if node:
            content = normalize_whitespace(node.get_text(" ", strip=True))
            break
    if not content and soup.body:
        content = normalize_whitespace(soup.body.get_text(" ", strip=True))

    if not content or len(content) < 100:
        return None
    if any(signal in content.lower() for signal in LOGIN_SIGNALS):
        log.debug("Paywall detected at %s", url)
        return None

    return content[:MAX_ARTICLE_CHARS]


def scrape_articles(urls: list[str]) -> tuple[Optional[str], bool]:
    """Scrape up to MAX_ARTICLES URLs and return (concatenated_text, any_error)."""
    if not urls:
        return None, False

    sections: list[str] = []
    any_error = False
    for url in urls[:MAX_ARTICLES]:
        text = scrape_article(url)
        if text:
            sections.append(f"Source: {url}\n{text}")
        else:
            any_error = True

    return ("\n\n".join(sections) if sections else None), any_error


def scrape_one(
    target: CandidateWebsiteTarget,
    scrape_websites: bool = True,
    scrape_news: bool = True,
) -> ScrapeResult:
    result = ScrapeResult(
        candidate_id=target.id,
        method=None,
        text=None,
        scrape_error=False,
        notes="",
    )

    if scrape_websites:
        url = target.campaign_website_url.strip()
        if not url:
            result.scrape_error = True
            result.notes = "empty_url"
        else:
            text, method, pages = crawl_domain(url)
            website_ok = bool(text and len(text) >= MIN_TEXT_LENGTH)
            result.method = method
            result.text = text if website_ok else None
            result.scrape_error = not website_ok
            result.notes = f"pages={pages}"

    if scrape_news:
        news_text, news_error = scrape_articles(target.news_article_urls)
        result.news_text = news_text
        result.news_scrape_error = news_error

    return result


def fetch_targets(supabase, force: bool = False, candidate_filter: Optional[str] = None) -> list[CandidateWebsiteTarget]:
    query = supabase.table("candidates").select(
        "id, full_name, campaign_website_url, news_article_urls"
    )
    if candidate_filter:
        query = query.ilike("full_name", f"%{candidate_filter}%")
    candidates = query.execute().data

    enrichment_rows = supabase.table("candidate_enrichment").select(
        "candidate_id, website_scraped_at, scrape_error, news_scraped_at"
    ).execute().data
    enrichment_by_candidate = {row["candidate_id"]: row for row in enrichment_rows}

    targets: list[CandidateWebsiteTarget] = []
    for row in candidates:
        enrichment = enrichment_by_candidate.get(row["id"]) or {}
        news_urls = row.get("news_article_urls") or []

        has_website = bool(row.get("campaign_website_url"))
        website_done = (
            has_website
            and enrichment.get("website_scraped_at")
            and not enrichment.get("scrape_error")
        )
        news_done = (
            not news_urls
            or (enrichment.get("news_scraped_at") and not enrichment.get("news_scrape_error"))
        )

        if not force:
            website_needed = has_website and not website_done
            news_needed = bool(news_urls) and not news_done
            if not website_needed and not news_needed:
                continue

        # Skip candidates with no website and no news articles
        if not has_website and not news_urls:
            continue

        targets.append(
            CandidateWebsiteTarget(
                id=row["id"],
                full_name=row["full_name"],
                campaign_website_url=row.get("campaign_website_url") or "",
                news_article_urls=news_urls,
            )
        )

    return targets


def persist_result(supabase, result: ScrapeResult) -> None:
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    payload: dict = {"candidate_id": result.candidate_id}

    if result.text is not None or result.scrape_error:
        payload.update({
            "scraped_website_text": result.text,
            "scrape_method": result.method,
            "scrape_error": result.scrape_error,
            "website_scraped_at": now_iso,
        })

    if result.news_text is not None or result.news_scrape_error:
        payload.update({
            "scraped_news_text": result.news_text,
            "news_scrape_error": result.news_scrape_error,
            "news_scraped_at": now_iso,
        })

    supabase.table("candidate_enrichment").upsert(
        payload, on_conflict="candidate_id"
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


def scrape_candidate_websites(
    force: bool = False,
    scrape_websites: bool = True,
    scrape_news: bool = True,
    candidate_filter: Optional[str] = None,
) -> dict[str, int]:
    supabase = get_client()
    targets = fetch_targets(supabase, force=force, candidate_filter=candidate_filter)
    mode = "websites+news" if (scrape_websites and scrape_news) else ("websites" if scrape_websites else "news")
    if candidate_filter:
        log.info(f"Targeting candidate matching {candidate_filter!r} ({len(targets)} found)  mode={mode}")
    else:
        log.info(f"Found {len(targets)} targets to scrape  mode={mode}")

    processed = 0
    errors = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_map = {
            executor.submit(scrape_one, target, scrape_websites, scrape_news): target
            for target in targets
        }

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
                log.warning(f"Website scrape issue for {target.full_name}: {result.notes}")
            if result.news_scrape_error:
                errors += 1
                log.warning(f"News scrape issue for {target.full_name}")

            website_chars = len(result.text or "")
            news_chars = len(result.news_text or "")
            parts = []
            if result.text is not None or result.scrape_error:
                parts.append(f"website={website_chars} chars")
            if result.news_text is not None or result.news_scrape_error:
                parts.append(f"news={news_chars} chars")
            if parts:
                log.info(f"Scraped {target.full_name} — {', '.join(parts)}")

    log_pipeline_run(supabase, processed, errors)
    return {"candidates_processed": processed, "errors": errors}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape candidate campaign websites and/or news articles.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-scrape all candidates, including those already scraped successfully.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--websites-only",
        action="store_true",
        help="Only crawl campaign websites; skip news articles.",
    )
    mode.add_argument(
        "--news-only",
        action="store_true",
        help="Only scrape news article URLs; skip campaign websites.",
    )
    parser.add_argument(
        "--candidate",
        metavar="NAME",
        default=None,
        help="Scrape a single candidate by name (case-insensitive substring match). "
             "Implies --force for that candidate. Example: --candidate lukas",
    )
    args = parser.parse_args()

    scrape_websites = not args.news_only
    scrape_news = not args.websites_only
    # --candidate implies force so it always re-scrapes even if previously done
    force = args.force or bool(args.candidate)

    log.info(f"=== scrape_candidate_websites.py  force={force}  websites={scrape_websites}  news={scrape_news} ===")
    try:
        summary = scrape_candidate_websites(force=force, scrape_websites=scrape_websites, scrape_news=scrape_news, candidate_filter=args.candidate)
        log.info(f"Done. Summary: {summary}")
        sys.exit(0)
    except Exception as exc:
        log.error(f"Fatal error: {exc}")
        raise
