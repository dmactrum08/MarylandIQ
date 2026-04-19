"""
run_no_summary_batch.py

Full pipeline batch for candidates listed in Import_no summary.csv.csv:
    1. Import article links from the CSV into the DB
    2. Scrape campaign websites + news articles for each candidate
    3. Scrape social media for each candidate
    4. Run AI enrichment for each candidate

Usage:
    python -m pipeline.run_no_summary_batch                      # all steps, lmstudio backend
    python -m pipeline.run_no_summary_batch --backend openrouter
    python -m pipeline.run_no_summary_batch --skip-import        # skip step 1
    python -m pipeline.run_no_summary_batch --skip-scrape        # skip steps 2+3
    python -m pipeline.run_no_summary_batch --enrich-only        # step 4 only
"""

from __future__ import annotations

import argparse
import csv
import logging
import sys
from pathlib import Path

from dotenv import load_dotenv

from pipeline.utils.supabase_client import get_client

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

NO_SUMMARY_CSV = Path(__file__).parent / "data" / "Import_no summary.csv.csv"


def read_slugs_from_csv() -> list[str]:
    """Return all non-empty slugs from the no-summary CSV."""
    if not NO_SUMMARY_CSV.exists():
        log.error(f"CSV not found: {NO_SUMMARY_CSV}")
        sys.exit(1)

    slugs: list[str] = []
    with open(NO_SUMMARY_CSV, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        reader.fieldnames = [f.strip() for f in (reader.fieldnames or [])]
        for row in reader:
            slug = row.get("slug", "").strip()
            if slug:
                slugs.append(slug)
    return slugs


def resolve_names(supabase, slugs: list[str]) -> list[str]:
    """Return full_name values for the given slugs (for use with --candidate flag)."""
    BATCH = 200
    names: list[str] = []
    for i in range(0, len(slugs), BATCH):
        chunk = slugs[i : i + BATCH]
        rows = (
            supabase.table("candidates")
            .select("full_name")
            .in_("slug", chunk)
            .execute()
            .data
        )
        names.extend(r["full_name"] for r in rows)
    return names


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Full pipeline batch for Import_no summary.csv.csv candidates."
    )
    parser.add_argument(
        "--backend", choices=["lmstudio", "gemini", "openrouter"], default="lmstudio",
        help="AI backend for enrichment (default: lmstudio)",
    )
    parser.add_argument(
        "--skip-import", action="store_true",
        help="Skip step 1 (link import). Use if you already ran import_csv_links.",
    )
    parser.add_argument(
        "--skip-scrape", action="store_true",
        help="Skip steps 2 and 3 (website + social scraping).",
    )
    parser.add_argument(
        "--enrich-only", action="store_true",
        help="Run step 4 (enrichment) only.",
    )
    args = parser.parse_args()

    supabase = get_client()
    slugs = read_slugs_from_csv()
    log.info(f"Found {len(slugs)} slugs in {NO_SUMMARY_CSV.name}")

    # ── Step 1: import links ──────────────────────────────────────────────────
    if not args.skip_import and not args.enrich_only:
        log.info("=== Step 1: Importing article links ===")
        from pipeline.import_csv_links import import_no_summary
        r = import_no_summary(supabase)
        log.info(f"  links imported: {r}")

    # ── Resolve names (needed for scrape + enrich) ────────────────────────────
    names = resolve_names(supabase, slugs)
    log.info(f"Resolved {len(names)} candidate names")
    if not names:
        log.error("No candidates matched the slugs — aborting.")
        sys.exit(1)

    # ── Step 2: scrape websites + news ───────────────────────────────────────
    if not args.skip_scrape and not args.enrich_only:
        log.info("=== Step 2: Scraping campaign websites + news ===")
        from pipeline.scrape_candidate_websites import scrape_candidate_websites
        for name in names:
            log.info(f"  Scraping website/news: {name}")
            try:
                scrape_candidate_websites(
                    force=True,
                    scrape_websites=True,
                    scrape_news=True,
                    candidate_filter=name,
                )
            except Exception as exc:
                log.error(f"  Error scraping {name}: {exc}")

    # ── Step 3: scrape social media ───────────────────────────────────────────
    if not args.skip_scrape and not args.enrich_only:
        log.info("=== Step 3: Scraping social media ===")
        from pipeline.scrape_social_media import scrape_social_media
        for name in names:
            log.info(f"  Scraping social: {name}")
            try:
                scrape_social_media(candidate_name=name)
            except Exception as exc:
                log.error(f"  Error scraping social for {name}: {exc}")

    # ── Step 4: AI enrichment ─────────────────────────────────────────────────
    log.info(f"=== Step 4: Enriching with {args.backend} ===")
    from pipeline.enrich_candidates import enrich_candidates
    for name in names:
        log.info(f"  Enriching: {name}")
        try:
            enrich_candidates(backend_name=args.backend, candidate_filter=name)
        except Exception as exc:
            log.error(f"  Error enriching {name}: {exc}")

    log.info("=== Batch complete ===")


if __name__ == "__main__":
    main()
