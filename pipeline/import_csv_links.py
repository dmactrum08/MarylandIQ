"""
import_csv_links.py

Imports social media links and news article URLs from two research CSVs into the
database. Only adds data where the database field is currently empty — existing
values are never overwritten.

Sources:
    pipeline/data/airscale_normalized.csv
        Columns: id, Facebook, Articles, Twitter, Campaign Site, Threads, Instagram

    pipeline/data/Import_Every Candidate_Article.csv
        Columns: id, Article URLs

Requires migration 009 to have been run first (adds instagram_url, threads_url,
news_article_urls columns).

Usage:
    python -m pipeline.import_csv_links
"""

from __future__ import annotations

import csv
import logging
import sys
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

from pipeline.utils.supabase_client import get_client

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent / "data"
AIRSCALE_CSV = DATA_DIR / "airscale_normalized.csv"
ARTICLES_CSV = DATA_DIR / "Import_Every Candidate_Article.csv"


# ---------------------------------------------------------------------------
# URL parsing helpers
# ---------------------------------------------------------------------------

def parse_urls(text: str) -> list[str]:
    """Split a cell that may contain multiple whitespace/semicolon-separated URLs."""
    if not text or text.strip().lower() in ("", "none"):
        return []
    normalized = text.replace(";", " ").replace("\n", " ").replace("\r", " ")
    return [p.strip() for p in normalized.split() if p.strip().startswith("http")]


def clean_url(text: str) -> Optional[str]:
    """Return a single URL from a cell, or None if empty/invalid."""
    text = text.strip()
    if not text:
        return None
    # Prefix bare facebook.com / www. URLs that are missing the scheme
    if text.startswith("facebook.com") or text.startswith("www."):
        text = "https://" + text
    return text if text.startswith("http") else None


# ---------------------------------------------------------------------------
# Read CSVs
# ---------------------------------------------------------------------------

def read_airscale() -> list[dict]:
    """Return rows from airscale_normalized.csv, stripping header whitespace."""
    rows = []
    with open(AIRSCALE_CSV, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        # Strip trailing/leading spaces from header names
        reader.fieldnames = [f.strip() for f in reader.fieldnames]
        for row in reader:
            rows.append({k.strip(): v.strip() for k, v in row.items()})
    return rows


def read_articles_csv() -> list[dict]:
    """Return rows from Import_Every Candidate_Article.csv."""
    rows = []
    with open(ARTICLES_CSV, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        reader.fieldnames = [f.strip() for f in reader.fieldnames]
        for row in reader:
            rows.append({k.strip(): v.strip() for k, v in row.items()})
    return rows


# ---------------------------------------------------------------------------
# Fetch current DB state
# ---------------------------------------------------------------------------

def fetch_candidates(supabase, ids: list[str]) -> dict[str, dict]:
    """Return a dict of candidate_id -> candidate row for the given IDs.

    Selects only the columns guaranteed to exist from schema.sql. The new
    instagram_url/threads_url columns (added in migration 009) are intentionally
    omitted here — they will always be null until migration 009 runs, so there
    is nothing to check and we should always attempt to write them.
    """
    BATCH = 200
    result: dict[str, dict] = {}
    for i in range(0, len(ids), BATCH):
        chunk = ids[i : i + BATCH]
        rows = (
            supabase.table("candidates")
            .select("id, facebook_url, twitter_handle, campaign_website_url")
            .in_("id", chunk)
            .execute()
            .data
        )
        for row in rows:
            result[row["id"]] = row
    return result


def fetch_enrichments(supabase, ids: list[str]) -> dict[str, list[str]]:
    """Return a dict of candidate_id -> existing news_article_urls list from candidates table."""
    BATCH = 200
    result: dict[str, list[str]] = {}
    try:
        for i in range(0, len(ids), BATCH):
            chunk = ids[i : i + BATCH]
            rows = (
                supabase.table("candidates")
                .select("id, news_article_urls")
                .in_("id", chunk)
                .execute()
                .data
            )
            for row in rows:
                result[row["id"]] = row.get("news_article_urls") or []
    except Exception as exc:
        if "news_article_urls" in str(exc):
            log.warning(
                "news_article_urls column not found on candidates — "
                "run database/013_news_article_urls_to_candidates.sql in Supabase SQL Editor first."
            )
        else:
            raise
    return result


# ---------------------------------------------------------------------------
# Apply updates
# ---------------------------------------------------------------------------

def merge_urls(existing: list[str], incoming: list[str]) -> list[str]:
    """Add incoming URLs that aren't already in the list (case-insensitive dedup)."""
    existing_lower = {u.lower() for u in existing}
    merged = list(existing)
    for url in incoming:
        if url.lower() not in existing_lower:
            merged.append(url)
            existing_lower.add(url.lower())
    return merged


# Columns that require migration 009 to exist
_MIGRATION_009_CANDIDATE_COLS = {"instagram_url", "threads_url"}
_migration_009_warned = False        # module-level flag; warn once
_migration_009_articles_warned = False


def update_candidate(supabase, candidate_id: str, current: dict, updates: dict) -> int:
    """Write only fields that are currently null/empty. Returns number of fields written.

    Existing columns (facebook_url, twitter_handle, campaign_website_url) are
    written in one batch. New columns added by migration 009 (instagram_url,
    threads_url) are written in a separate attempt; if those columns don't exist
    yet a one-time warning is logged and those values are skipped.
    """
    global _migration_009_warned

    existing_payload: dict = {}
    new_payload: dict = {}

    for col, new_val in updates.items():
        if not new_val:
            continue
        if col in _MIGRATION_009_CANDIDATE_COLS:
            new_payload[col] = new_val
        elif not current.get(col):
            existing_payload[col] = new_val

    written = 0

    if existing_payload:
        supabase.table("candidates").update(existing_payload).eq("id", candidate_id).execute()
        written += len(existing_payload)

    if new_payload:
        try:
            supabase.table("candidates").update(new_payload).eq("id", candidate_id).execute()
            written += len(new_payload)
        except Exception as exc:
            if any(col in str(exc) for col in _MIGRATION_009_CANDIDATE_COLS):
                if not _migration_009_warned:
                    log.warning(
                        "instagram_url / threads_url columns not found. "
                        "Run database/009_social_media_columns.sql in Supabase SQL Editor "
                        "then re-run this script to populate those fields."
                    )
                    _migration_009_warned = True
            else:
                raise

    return written


def upsert_enrichment_articles(
    supabase,
    candidate_id: str,
    existing_urls: list[str],
    new_urls: list[str],
) -> int:
    """Merge new article URLs into candidates.news_article_urls. Returns number added."""
    global _migration_009_articles_warned

    merged = merge_urls(existing_urls, new_urls)
    added = len(merged) - len(existing_urls)
    if added == 0:
        return 0

    try:
        supabase.table("candidates").update(
            {"news_article_urls": merged}
        ).eq("id", candidate_id).execute()
    except Exception as exc:
        if "news_article_urls" in str(exc):
            if not _migration_009_articles_warned:
                log.warning(
                    "news_article_urls column not found on candidates. "
                    "Run database/013_news_article_urls_to_candidates.sql in Supabase SQL Editor "
                    "then re-run this script to populate article URLs."
                )
                _migration_009_articles_warned = True
            return 0
        raise

    return added


# ---------------------------------------------------------------------------
# Main import logic
# ---------------------------------------------------------------------------

def import_airscale(supabase) -> dict[str, int]:
    log.info(f"Reading {AIRSCALE_CSV.name} ...")
    rows = read_airscale()
    log.info(f"  {len(rows)} rows")

    candidate_ids = [r["id"] for r in rows if r.get("id")]
    current_candidates = fetch_candidates(supabase, candidate_ids)
    current_enrichments = fetch_enrichments(supabase, candidate_ids)

    cand_fields_written = 0
    articles_added = 0
    skipped = 0

    for row in rows:
        cid = row.get("id", "").strip()
        if not cid:
            skipped += 1
            continue

        if cid not in current_candidates:
            log.warning(f"  Candidate {cid} not found in DB — skipping")
            skipped += 1
            continue

        current = current_candidates[cid]

        # Build candidate field updates
        candidate_updates = {
            "facebook_url": clean_url(row.get("Facebook", "")),
            "twitter_handle": clean_url(row.get("Twitter", "")) or row.get("Twitter", "").strip() or None,
            "campaign_website_url": clean_url(row.get("Campaign Site", "")),
            "instagram_url": clean_url(row.get("Instagram", "")),
            "threads_url": clean_url(row.get("Threads", "")),
        }
        # Remove None values
        candidate_updates = {k: v for k, v in candidate_updates.items() if v}

        written = update_candidate(supabase, cid, current, candidate_updates)
        cand_fields_written += written

        # Article URLs
        new_articles = parse_urls(row.get("Articles", ""))
        if new_articles:
            added = upsert_enrichment_articles(
                supabase, cid, current_enrichments.get(cid, []), new_articles
            )
            articles_added += added

    log.info(
        f"  airscale: {cand_fields_written} candidate fields written, "
        f"{articles_added} article URLs added, {skipped} rows skipped"
    )
    return {"fields_written": cand_fields_written, "articles_added": articles_added, "skipped": skipped}


def import_article_csv(supabase) -> dict[str, int]:
    log.info(f"Reading {ARTICLES_CSV.name} ...")
    rows = read_articles_csv()
    log.info(f"  {len(rows)} rows")

    # The id column may have a trailing space in the header
    id_col = "id"  # already stripped by read_articles_csv

    candidate_ids = [r.get(id_col, "").strip() for r in rows if r.get(id_col, "").strip()]
    current_enrichments = fetch_enrichments(supabase, candidate_ids)

    # Also verify these candidates exist
    current_candidates = fetch_candidates(supabase, candidate_ids)

    articles_added = 0
    skipped = 0

    for row in rows:
        cid = row.get(id_col, "").strip()
        if not cid:
            skipped += 1
            continue

        if cid not in current_candidates:
            log.warning(f"  Candidate {cid} not found in DB — skipping")
            skipped += 1
            continue

        url_text = row.get("Article URLs", "").strip()
        new_articles = parse_urls(url_text)
        if not new_articles:
            continue

        added = upsert_enrichment_articles(
            supabase, cid, current_enrichments.get(cid, []), new_articles
        )
        articles_added += added

    log.info(
        f"  articles CSV: {articles_added} article URLs added, {skipped} rows skipped"
    )
    return {"articles_added": articles_added, "skipped": skipped}


def main() -> None:
    supabase = get_client()

    log.info("=== import_csv_links.py ===")
    r1 = import_airscale(supabase)
    r2 = import_article_csv(supabase)

    total_fields = r1["fields_written"]
    total_articles = r1["articles_added"] + r2["articles_added"]
    total_skipped = r1["skipped"] + r2["skipped"]

    log.info(
        f"Done. candidate fields written={total_fields}, "
        f"article URLs added={total_articles}, rows skipped={total_skipped}"
    )

    supabase.table("pipeline_runs").insert(
        {
            "script_name": "import_csv_links.py",
            "candidates_processed": total_fields,
            "notes": f"article_urls_added={total_articles} skipped={total_skipped}",
        }
    ).execute()


if __name__ == "__main__":
    main()
