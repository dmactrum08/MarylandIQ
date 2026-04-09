"""
ingest_ballot_measures.py

Stage 3 script — scrape Maryland 2026 ballot measures, upsert into
ballot_measures table, and generate plain-language AI summaries.

Sources (tried in order, best-wins):
  1. Ballotpedia Maryland 2026 ballot measures page (reliable, well-structured)
  2. Maryland SBE ballot questions page (authoritative once live, usually closer to election)

Only CERTIFIED measures are ingested. "Potential" measures on Ballotpedia
are logged but skipped — re-run the script once they are certified.

Idempotent — safe to re-run at any time. Re-generates the AI summary only
if official_text has changed since the last run.

SCHEMA PREREQUISITE — run once in Supabase SQL editor before first run:
    ALTER TABLE ballot_measures ALTER COLUMN jurisdiction_id DROP NOT NULL;
NULL jurisdiction_id = statewide measure (appears on all ballots).

TO CLEAR BAD DATA — run in Supabase SQL editor if junk rows exist:
    DELETE FROM ballot_measures WHERE title ILIKE '%mail%'
      OR title ILIKE '%register%' OR title ILIKE '%how to vote%';
Or to wipe all and start fresh:
    TRUNCATE ballot_measures;

Usage:
    python -m pipeline.ingest_ballot_measures                    # Gemini (default)
    python -m pipeline.ingest_ballot_measures --backend openrouter
    python -m pipeline.ingest_ballot_measures --backend lmstudio
    python -m pipeline.ingest_ballot_measures --no-ai            # ingest only, skip AI
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
import time
from dataclasses import dataclass, field
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

REQUEST_TIMEOUT = 15
USER_AGENT = "MarylandIQ/1.0 (voter information platform; contact@marylandiq.com)"

PRIMARY_DATE = "2026-06-23"
GENERAL_DATE = "2026-11-03"

BALLOTPEDIA_URL = "https://ballotpedia.org/Maryland_2026_ballot_measures"

SBE_BALLOT_QUESTION_URLS = [
    "https://elections.maryland.gov/elections/2026/ballot_questions/index.html",
    "https://elections.maryland.gov/elections/2026/ballot_questions/2026_Ballot_Questions.html",
]

# Phrases that indicate the page content is NOT a ballot measure
VOTING_INFO_PHRASES = [
    "how to vote", "register to vote", "mail-in ballot", "absentee",
    "early voting", "polling place", "voter registration", "election day",
    "drop box", "request a ballot", "sample ballot",
]


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class BallotMeasure:
    slug: str
    title: str
    official_text: Optional[str]
    source_url: str
    election_date: str
    jurisdiction_id: Optional[str] = None  # None = statewide
    certified: bool = True


# ---------------------------------------------------------------------------
# Slugification
# ---------------------------------------------------------------------------

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"['\u2019\u2018]", "", text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def make_measure_slug(title: str, election_date: str) -> str:
    year = election_date[:4]
    etype = "primary" if election_date == PRIMARY_DATE else "general"
    return f"md-{slugify(title[:55])}-{year}-{etype}"


# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------

def _fetch(url: str) -> Optional[BeautifulSoup]:
    try:
        resp = requests.get(
            url, timeout=REQUEST_TIMEOUT, headers={"User-Agent": USER_AGENT}
        )
        if resp.status_code == 200:
            return BeautifulSoup(resp.text, "lxml")
        log.debug(f"HTTP {resp.status_code} — {url}")
    except Exception as exc:
        log.debug(f"Request failed for {url}: {exc}")
    return None


# ---------------------------------------------------------------------------
# Ballotpedia scraper
# ---------------------------------------------------------------------------

def scrape_ballotpedia_detail(detail_url: str) -> Optional[str]:
    """
    Fetch a Ballotpedia measure detail page and extract the Overview and
    'Text of measure' sections as the official_text for AI summarization.
    Returns None if the page is unavailable.
    """
    log.info(f"  Fetching detail page: {detail_url}")
    soup = _fetch(detail_url)
    if not soup:
        return None

    DETAIL_SECTIONS = {"overview", "text of measure"}
    chunks: list[str] = []

    for h2 in soup.find_all("h2"):
        if h2.get_text(strip=True).lower() not in DETAIL_SECTIONS:
            continue
        for sib in h2.find_next_siblings():
            if sib.name == "h2":
                break
            text = sib.get_text(" ", strip=True)
            if text:
                chunks.append(text)

    combined = "\n\n".join(chunks)
    return combined[:6000] if combined else None


def scrape_ballotpedia() -> list[BallotMeasure]:
    """
    Scrape only the 'On the ballot' table from the Ballotpedia Maryland 2026
    ballot measures page, then follow each measure's detail link for full content.

    Page structure (confirmed):
      <h2>On the ballot</h2>
      <table class="bptable blue">
        <tr><th>Type</th><th>Title</th><th>Subject</th><th>Description</th></tr>
        <tr><td>LRCA</td><td><a href="...">Title text</a></td><td>...</td><td>desc</td></tr>
      </table>
      <h2>Potential measures</h2>  ← stop here
    """
    log.info(f"Fetching Ballotpedia listing: {BALLOTPEDIA_URL}")
    soup = _fetch(BALLOTPEDIA_URL)
    if not soup:
        log.warning("Could not fetch Ballotpedia page.")
        return []

    on_ballot_h2 = None
    for h2 in soup.find_all("h2"):
        if "on the ballot" in h2.get_text(strip=True).lower():
            on_ballot_h2 = h2
            break

    if not on_ballot_h2:
        log.warning("Ballotpedia: could not find 'On the ballot' section.")
        return []

    table = on_ballot_h2.find_next_sibling("table", class_="bptable")
    if not table:
        log.warning("Ballotpedia: no bptable found under 'On the ballot' section.")
        return []

    measures: list[BallotMeasure] = []

    for row in table.find_all("tr")[1:]:  # skip header row
        cells = row.find_all("td")
        if len(cells) < 4:
            continue

        title_cell = cells[1]
        a_tag = title_cell.find("a")
        title = a_tag.get_text(" ", strip=True) if a_tag else title_cell.get_text(" ", strip=True)
        detail_url = a_tag["href"] if a_tag and a_tag.get("href") else BALLOTPEDIA_URL

        if not title:
            continue

        log.info(f"  Found (certified): {title}")

        # Follow the detail link for richer official_text
        time.sleep(1)
        official_text = scrape_ballotpedia_detail(detail_url)

        # Fall back to the short table description if detail page fails
        if not official_text:
            official_text = cells[3].get_text(" ", strip=True) or None
            log.warning(f"  Detail page unavailable — using table description as fallback")

        measures.append(BallotMeasure(
            slug=make_measure_slug(title, GENERAL_DATE),
            title=title,
            official_text=official_text,
            source_url=detail_url,
            election_date=GENERAL_DATE,
            certified=True,
        ))

    return measures


# ---------------------------------------------------------------------------
# SBE scraper (authoritative once live)
# ---------------------------------------------------------------------------

def scrape_sbe() -> list[BallotMeasure]:
    """
    Try the SBE ballot questions page. Returns empty list if not yet published.
    When live, SBE text takes precedence over Ballotpedia for official_text.
    """
    for url in SBE_BALLOT_QUESTION_URLS:
        log.info(f"Trying SBE URL: {url}")
        soup = _fetch(url)
        if not soup:
            continue

        measures = _parse_sbe_page(soup, url)
        if measures:
            log.info(f"Found {len(measures)} measures on SBE page.")
            return measures

    log.info("SBE ballot questions page not yet available.")
    return []


def _parse_sbe_page(soup: BeautifulSoup, source_url: str) -> list[BallotMeasure]:
    measures: list[BallotMeasure] = []

    for heading in soup.find_all(["h2", "h3"]):
        title = heading.get_text(" ", strip=True)

        if len(title) < 15:
            continue

        # Skip voting-info headings
        if any(phrase in title.lower() for phrase in VOTING_INFO_PHRASES):
            continue

        # Must look like a ballot question, not a page section
        ballot_signals = [
            "question", "amendment", "referendum", "act", "measure",
            "constitutional", "proposition",
        ]
        if not any(sig in title.lower() for sig in ballot_signals):
            continue

        body_parts: list[str] = []
        for sibling in heading.find_next_siblings():
            if sibling.name in ("h2", "h3"):
                break
            text = sibling.get_text(" ", strip=True)
            # Stop if we hit voting-info content
            if any(phrase in text.lower() for phrase in VOTING_INFO_PHRASES):
                break
            if text:
                body_parts.append(text)
            if len(body_parts) >= 8:
                break

        official_text = " ".join(body_parts) if body_parts else None
        election_date = GENERAL_DATE
        if "primary" in title.lower():
            election_date = PRIMARY_DATE

        measures.append(BallotMeasure(
            slug=make_measure_slug(title, election_date),
            title=title,
            official_text=official_text,
            source_url=source_url,
            election_date=election_date,
            certified=True,
        ))

    return measures


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def fetch_existing(supabase) -> dict[str, dict]:
    rows = supabase.table("ballot_measures").select(
        "id, slug, official_text, plain_language_summary"
    ).execute().data
    return {r["slug"]: r for r in rows}


def upsert_measures(
    supabase, measures: list[BallotMeasure], existing: dict[str, dict]
) -> tuple[list[str], list[str]]:
    """Returns (new_slugs, updated_slugs) for AI summary targeting."""
    new_slugs: list[str] = []
    updated_slugs: list[str] = []

    for m in measures:
        row = {
            "slug": m.slug,
            "title": m.title,
            "official_text": m.official_text,
            "source_url": m.source_url,
            "election_date": m.election_date,
            "jurisdiction_id": m.jurisdiction_id,
        }

        if m.slug not in existing:
            supabase.table("ballot_measures").insert(row).execute()
            new_slugs.append(m.slug)
            log.info(f"  Inserted: {m.title[:70]}")
        else:
            prev = existing[m.slug]
            text_changed = (
                m.official_text
                and m.official_text != prev.get("official_text")
            )
            if text_changed:
                row["plain_language_summary"] = None
                row["summary_generated_at"] = None
                supabase.table("ballot_measures").update(row).eq("slug", m.slug).execute()
                updated_slugs.append(m.slug)
                log.info(f"  Updated (text changed): {m.title[:70]}")
            else:
                log.info(f"  Unchanged: {m.title[:70]}")

    return new_slugs, updated_slugs


# ---------------------------------------------------------------------------
# AI backends
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = (
    "You are writing plain-language summaries for a nonpartisan Maryland voter "
    "information platform. Write clearly, factually, and without bias. "
    "Do not take a position. Output only the summary text — no title, no markdown, "
    "no preamble."
)

SUMMARY_PROMPT = (
    "Write a 2-3 sentence plain-language summary of this Maryland ballot measure "
    "for a typical voter. Explain what it does, what a YES vote means, and what a "
    "NO vote means. Be neutral.\n\n"
    "Title: {title}\n\n"
    "Description:\n{official_text}"
)


class GeminiBackend:
    def __init__(self):
        import google.generativeai as genai
        api_key = os.environ.get("GOOGLE_AI_STUDIO_API_KEY")
        if not api_key:
            log.error("GOOGLE_AI_STUDIO_API_KEY not set")
            sys.exit(1)
        genai.configure(api_key=api_key)
        self._model = genai.GenerativeModel(
            model_name="gemini-flash-latest", system_instruction=SYSTEM_PROMPT
        )
        log.info("Backend: Gemini")

    def call(self, prompt: str) -> str:
        return self._model.generate_content(prompt).text

    def sleep(self):
        time.sleep(4)


class OpenRouterBackend:
    def __init__(self):
        from openai import OpenAI
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            log.error("OPENROUTER_API_KEY not set")
            sys.exit(1)
        model = os.environ.get("OPENROUTER_MODEL", "google/gemini-2.5-flash-preview")
        self._model = model
        self._client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
        log.info(f"Backend: OpenRouter  model={model}")

    def call(self, prompt: str) -> str:
        resp = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
        )
        return resp.choices[0].message.content

    def sleep(self):
        time.sleep(1)


class LMStudioBackend:
    def __init__(self):
        from openai import OpenAI
        model = os.environ.get("LM_STUDIO_MODEL", "local-model")
        self._model = model
        self._client = OpenAI(base_url="http://localhost:1234/v1", api_key="lm-studio")
        log.info(f"Backend: LM Studio  model={model}")

    def call(self, prompt: str) -> str:
        resp = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
        )
        return resp.choices[0].message.content

    def sleep(self):
        pass


def make_backend(name: str):
    if name == "openrouter":
        return OpenRouterBackend()
    if name == "lmstudio":
        return LMStudioBackend()
    return GeminiBackend()


def generate_summaries(supabase, slugs: list[str], backend) -> int:
    if not slugs:
        return 0

    rows = (
        supabase.table("ballot_measures")
        .select("id, slug, title, official_text")
        .in_("slug", slugs)
        .is_("plain_language_summary", "null")
        .execute()
        .data
    )

    generated = 0
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    for i, row in enumerate(rows):
        if i > 0:
            backend.sleep()
        if not row.get("official_text"):
            log.warning(f"No official text for {row['slug']} — skipping summary")
            continue

        log.info(f"Generating summary: {row['title'][:70]}")
        prompt = SUMMARY_PROMPT.format(
            title=row["title"],
            official_text=row["official_text"][:3000],
        )
        try:
            summary = backend.call(prompt).strip()
        except Exception as exc:
            log.error(f"AI error for {row['slug']}: {exc}")
            continue

        if not summary:
            continue

        supabase.table("ballot_measures").update({
            "plain_language_summary": summary,
            "summary_generated_at": now_iso,
        }).eq("id", row["id"]).execute()

        generated += 1
        log.info(f"  → {summary[:100]}{'...' if len(summary) > 100 else ''}")

    return generated


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def ingest_ballot_measures(backend_name: str = "gemini", skip_ai: bool = False) -> dict:
    supabase = get_client()
    start = time.time()

    # Step 1: scrape SBE (authoritative, usually 404 until closer to election)
    sbe_measures = scrape_sbe()

    # Step 2: scrape Ballotpedia (reliable fallback / supplement)
    bp_measures = scrape_ballotpedia()

    # Merge: SBE wins on slug collisions (more authoritative official text)
    sbe_slugs = {m.slug for m in sbe_measures}
    bp_unique = [m for m in bp_measures if m.slug not in sbe_slugs]
    all_measures = sbe_measures + bp_unique

    log.info(
        f"Total measures to process: {len(all_measures)} "
        f"({len(sbe_measures)} SBE, {len(bp_unique)} Ballotpedia-only)"
    )

    if not all_measures:
        log.info("No certified measures found.")
        supabase.table("pipeline_runs").insert({
            "script_name": "ingest_ballot_measures.py",
            "candidates_processed": 0,
            "notes": "no certified measures found",
        }).execute()
        return {"sbe": 0, "ballotpedia": 0, "new": 0, "updated": 0, "summaries": 0}

    # Step 3: upsert
    existing = fetch_existing(supabase)
    new_slugs, updated_slugs = upsert_measures(supabase, all_measures, existing)

    # Step 4: AI summaries for new/updated measures
    summaries_generated = 0
    if not skip_ai:
        needs_summary = new_slugs + updated_slugs
        if needs_summary:
            backend = make_backend(backend_name)
            summaries_generated = generate_summaries(supabase, needs_summary, backend)
    else:
        log.info("--no-ai set — skipping summary generation.")

    duration = round(time.time() - start, 1)
    supabase.table("pipeline_runs").insert({
        "script_name": "ingest_ballot_measures.py",
        "candidates_processed": len(all_measures),
        "new_detected": len(new_slugs),
        "duration_seconds": duration,
        "notes": (
            f"backend={backend_name} sbe={len(sbe_measures)} "
            f"ballotpedia={len(bp_unique)} new={len(new_slugs)} "
            f"updated={len(updated_slugs)} summaries={summaries_generated}"
        ),
    }).execute()

    return {
        "sbe": len(sbe_measures),
        "ballotpedia": len(bp_unique),
        "new": len(new_slugs),
        "updated": len(updated_slugs),
        "summaries": summaries_generated,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Ingest Maryland 2026 ballot measures and generate AI summaries."
    )
    parser.add_argument(
        "--backend",
        choices=["gemini", "openrouter", "lmstudio"],
        default="gemini",
        help="AI backend for summary generation (default: gemini)",
    )
    parser.add_argument(
        "--no-ai",
        action="store_true",
        help="Skip AI summary generation — ingest data only.",
    )
    args = parser.parse_args()

    log.info(f"=== ingest_ballot_measures.py  backend={args.backend} ===")
    try:
        result = ingest_ballot_measures(backend_name=args.backend, skip_ai=args.no_ai)
        log.info(f"Done. {result}")
        sys.exit(0)
    except Exception as exc:
        log.error(f"Fatal error: {exc}")
        raise
