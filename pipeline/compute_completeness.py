"""
compute_completeness.py

Stage 2 script — score each candidate 0–100 and write to candidates.completeness_score.

Scoring formula (section 4.7):
    +20  official fields complete (name, party, filing_status, filed_date)
    +15  campaign_website_url is set
    +20  scraped_website_text length > 200 chars
    +20  ai_summary is not null
    +15  issue_tags count >= 2
    +10  any social link set (facebook_url, twitter_handle, linkedin_url)
    ---
    100  max

Threshold rules:
    >= 60  full display, no badge
    40–59  'some info unavailable' badge
    < 40   triggers social inference pipeline on next weekly run
"""

from __future__ import annotations

import logging
import sys
from dataclasses import dataclass
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


@dataclass
class CandidateRow:
    candidate_id: str
    full_name: str
    party: Optional[str]
    filing_status: str
    filed_date: Optional[str]
    campaign_website_url: Optional[str]
    facebook_url: Optional[str]
    twitter_handle: Optional[str]
    linkedin_url: Optional[str]
    instagram_url: Optional[str]
    threads_url: Optional[str]
    scraped_website_text: Optional[str]
    ai_summary: Optional[str]
    issue_tags: list
    news_article_urls: list


def compute_score(row: CandidateRow) -> int:
    score = 0

    # +20: official fields complete
    if row.full_name and row.party and row.filing_status and row.filed_date:
        score += 20

    # +15: campaign website URL set
    if row.campaign_website_url:
        score += 15

    # +20: scraped website text > 200 chars
    if row.scraped_website_text and len(row.scraped_website_text) > 200:
        score += 20

    # +20: AI summary present
    if row.ai_summary:
        score += 20

    # +15: at least 2 issue tags
    if isinstance(row.issue_tags, list) and len(row.issue_tags) >= 2:
        score += 15

    # +10: any social link (includes Instagram and Threads)
    if row.facebook_url or row.twitter_handle or row.linkedin_url or row.instagram_url or row.threads_url:
        score += 10

    # +5: has news article coverage (capped by overall max of 100)
    if isinstance(row.news_article_urls, list) and row.news_article_urls:
        score += 5

    return min(score, 100)


def fetch_candidates(supabase) -> list[CandidateRow]:
    records = (
        supabase.table("candidates")
        .select(
            "id, full_name, party, filing_status, filed_date, "
            "campaign_website_url, facebook_url, twitter_handle, linkedin_url, "
            "instagram_url, threads_url, "
            "candidate_enrichment(scraped_website_text, ai_summary, issue_tags, news_article_urls)"
        )
        .execute()
        .data
    )

    if not records:
        return []

    rows: list[CandidateRow] = []
    for c in records:
        enr = c.get("candidate_enrichment") or {}
        if isinstance(enr, list):
            enr = enr[0] if enr else {}
        rows.append(
            CandidateRow(
                candidate_id=c["id"],
                full_name=c.get("full_name", ""),
                party=c.get("party"),
                filing_status=c.get("filing_status", ""),
                filed_date=c.get("filed_date"),
                campaign_website_url=c.get("campaign_website_url"),
                facebook_url=c.get("facebook_url"),
                twitter_handle=c.get("twitter_handle"),
                linkedin_url=c.get("linkedin_url"),
                instagram_url=c.get("instagram_url"),
                threads_url=c.get("threads_url"),
                scraped_website_text=enr.get("scraped_website_text"),
                ai_summary=enr.get("ai_summary"),
                issue_tags=enr.get("issue_tags") or [],
                news_article_urls=enr.get("news_article_urls") or [],
            )
        )

    return rows


def compute_completeness() -> dict[str, int]:
    supabase = get_client()
    rows = fetch_candidates(supabase)
    log.info(f"Scoring {len(rows)} candidates")

    buckets = {"full": 0, "partial": 0, "thin": 0}
    updates = 0
    errors = 0

    for row in rows:
        score = compute_score(row)

        if score >= 60:
            buckets["full"] += 1
        elif score >= 40:
            buckets["partial"] += 1
        else:
            buckets["thin"] += 1

        try:
            supabase.table("candidates").update(
                {"completeness_score": score}
            ).eq("id", row.candidate_id).execute()
            updates += 1
        except Exception as exc:
            log.error(f"DB write error for {row.full_name}: {exc}")
            errors += 1

    log.info(
        f"Done. full(>=60)={buckets['full']}  "
        f"partial(40-59)={buckets['partial']}  "
        f"thin(<40)={buckets['thin']}  "
        f"errors={errors}"
    )

    supabase.table("pipeline_runs").insert(
        {
            "script_name": "compute_completeness.py",
            "candidates_processed": updates,
            "errors": errors,
            "notes": (
                f"full={buckets['full']} partial={buckets['partial']} thin={buckets['thin']}"
            ),
        }
    ).execute()

    return {"updated": updates, "errors": errors, **buckets}


if __name__ == "__main__":
    log.info("=== compute_completeness.py ===")
    try:
        result = compute_completeness()
        log.info(f"Done. {result}")
        sys.exit(0)
    except Exception as exc:
        log.error(f"Fatal error: {exc}")
        raise
