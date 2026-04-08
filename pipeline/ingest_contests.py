"""
ingest_contests.py

Stage 1 script — scrapes Maryland SBE 2026 election pages and populates
the offices and contests tables.

Run once before the filing period opens (and re-run if the SBE page changes).
This script does NOT ingest candidates — that's ingest_sbe_candidates.py (Stage 2).

Usage:
    python -m pipeline.ingest_contests

Prerequisites:
    - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set in .env
    - jurisdictions table seeded

Source URL:
    https://elections.maryland.gov/elections/2026/Primary_candidates/2026_GP_all_counties_candidatelist.html
    (Current live local-candidate page as of April 8, 2026)
"""

import logging
import re
import sys
import time
from dataclasses import dataclass
from typing import Optional

import requests
from bs4 import BeautifulSoup

from pipeline.utils.supabase_client import get_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Current live local-candidate page for the 2026 primary.
SBE_LOCAL_CANDIDATES_URL = (
    "https://elections.maryland.gov/elections/2026/Primary_candidates/"
    "2026_GP_all_counties_candidatelist.html"
)

# Secondary page listing office categories for 2026.
SBE_OFFICES_URL = "https://elections.maryland.gov/candidacy/ballot.html"

# Legacy/fallback 2026 election landing page.
SBE_ELECTION_INDEX_URL = "https://elections.maryland.gov/elections/2026/index.html"

# 2026 Maryland election dates
ELECTION_DATES = {
    "primary": "2026-06-23",
    "general": "2026-11-03",
}

REQUEST_TIMEOUT = 15
REQUEST_DELAY = 1.0

# ---------------------------------------------------------------------------
# Known office definitions for Maryland county races
# We seed these directly since they're stable and predictable.
# The SBE page confirms which are on the 2026 ballot; we use it to populate
# the contests table (which jurisdiction × district combinations exist).
# ---------------------------------------------------------------------------

KNOWN_OFFICES = [
    {
        "slug": "county-executive",
        "name": "County Executive",
    },
    {
        "slug": "county-council-member",
        "name": "County Council Member",
    },
    {
        "slug": "county-commissioner",
        "name": "County Commissioner",
    },
    {
        "slug": "board-of-education",
        "name": "Board of Education Member",
    },
    {
        "slug": "sheriff",
        "name": "Sheriff",
    },
    {
        "slug": "states-attorney",
        "name": "State's Attorney",
    },
    {
        "slug": "register-of-wills",
        "name": "Register of Wills",
    },
    {
        "slug": "clerk-of-circuit-court",
        "name": "Clerk of the Circuit Court",
    },
    {
        "slug": "orphans-court-judge",
        "name": "Orphans' Court Judge",
    },
    {
        "slug": "county-treasurer",
        "name": "County Treasurer",
    },
    {
        "slug": "comptroller",
        "name": "Comptroller",
    },
    {
        "slug": "county-council-at-large",
        "name": "County Council Member (At-Large)",
    },
]


@dataclass
class ContestRecord:
    office_slug: str
    office_name: str
    jurisdiction_slug: str
    district_name: Optional[str]
    election_type: str
    election_date: str
    seats_available: int = 1
    sbe_contest_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Slugification helpers
# ---------------------------------------------------------------------------

def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"['\u2019]", "", text)   # remove apostrophes
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def make_contest_slug(
    jurisdiction_slug: str,
    office_slug: str,
    district_name: Optional[str],
    election_type: str,
    year: str = "2026",
) -> str:
    parts = [jurisdiction_slug, office_slug]
    if district_name:
        parts.append(slugify(district_name))
    parts.extend([year, election_type])
    return "-".join(parts)


# ---------------------------------------------------------------------------
# SBE scraping
# ---------------------------------------------------------------------------

def fetch_sbe_page() -> Optional[BeautifulSoup]:
    """Attempt to fetch the primary live SBE page, with fallbacks."""
    for url in [SBE_LOCAL_CANDIDATES_URL, SBE_OFFICES_URL, SBE_ELECTION_INDEX_URL]:
        try:
            log.info(f"Fetching SBE page: {url}")
            resp = requests.get(url, timeout=REQUEST_TIMEOUT, headers={
                "User-Agent": "MarylandIQ/1.0 (voter information platform; contact@marylandiq.com)"
            })
            if resp.status_code == 200:
                log.info(f"  Success ({resp.status_code})")
                return BeautifulSoup(resp.text, "html.parser")
            else:
                log.warning(f"  HTTP {resp.status_code} — trying next URL")
        except requests.RequestException as e:
            log.warning(f"  Request failed for {url}: {e}")
        time.sleep(REQUEST_DELAY)

    return None


def is_jurisdiction_heading(text: str, jurisdiction_map: dict[str, str]) -> bool:
    return match_jurisdiction_slug(text, jurisdiction_map) is not None


def normalize_district_name(text: str) -> Optional[str]:
    raw = text.strip()
    if not raw:
        return None

    match = re.search(r"district\s+([a-z0-9-]+)$", raw, flags=re.IGNORECASE)
    if match:
        return f"District {match.group(1).upper()}"

    if "at large" in raw.lower():
        return "At-Large"

    return raw


def match_office_slug(text: str) -> Optional[str]:
    normalized = slugify(text)
    text_lower = text.lower()

    if "county council" in text_lower and "at large" in text_lower:
        return "county-council-at-large"
    if "board of education" in text_lower or "school board" in text_lower:
        return "board-of-education"
    if "county council" in text_lower or "councilmanic" in text_lower:
        return "county-council-member"
    if "commissioner" in text_lower:
        return "county-commissioner"

    for office in KNOWN_OFFICES:
        if office["name"].lower() in text_lower or office["slug"] in normalized:
            return office["slug"]
    return None


def parse_live_candidate_page(soup: BeautifulSoup, jurisdiction_map: dict) -> list[ContestRecord]:
    """
    Parse the live 2026 local candidate page.

    The current Maryland SBE page is organized by headings:
      h2 = jurisdiction
      h3 = office group
      h4 = district within that office group OR candidate name
      h5 = candidate name for district-based races
    """
    contests: list[ContestRecord] = []
    seen: set[tuple[str, str, Optional[str], str]] = set()

    current_jurisdiction_slug: Optional[str] = None
    current_office_heading: Optional[str] = None
    current_office_has_districts = False

    def append_contest(
        jurisdiction_slug: str,
        office_slug: str,
        district_name: Optional[str],
    ) -> None:
        record = ContestRecord(
            office_slug=office_slug,
            office_name=get_office_name(office_slug),
            jurisdiction_slug=jurisdiction_slug,
            district_name=district_name,
            election_type="primary",
            election_date=ELECTION_DATES["primary"],
        )
        key = (
            record.jurisdiction_slug,
            record.office_slug,
            record.district_name,
            record.election_type,
        )
        if key not in seen:
            seen.add(key)
            contests.append(record)

    def flush_countywide_office() -> None:
        nonlocal current_office_heading, current_office_has_districts
        if not current_jurisdiction_slug or not current_office_heading or current_office_has_districts:
            return

        office_slug = match_office_slug(current_office_heading)
        if office_slug:
            append_contest(current_jurisdiction_slug, office_slug, None)

        current_office_heading = None
        current_office_has_districts = False

    for element in soup.find_all(["h2", "h3", "h4", "h5"]):
        text = element.get_text(" ", strip=True)
        if not text:
            continue

        if element.name == "h2" and is_jurisdiction_heading(text, jurisdiction_map):
            flush_countywide_office()
            current_jurisdiction_slug = match_jurisdiction_slug(text, jurisdiction_map)
            current_office_heading = None
            current_office_has_districts = False
            continue

        if not current_jurisdiction_slug:
            continue

        if element.name == "h3":
            flush_countywide_office()
            current_office_heading = text
            current_office_has_districts = False
            continue

        if element.name == "h4" and current_office_heading:
            office_slug = match_office_slug(current_office_heading)
            district_name = normalize_district_name(text)

            # Candidate names appear at h4 for county-wide races; district labels
            # appear at h4 for district-based races.
            if office_slug and district_name:
                if "district" in district_name.lower():
                    current_office_has_districts = True
                    append_contest(current_jurisdiction_slug, office_slug, district_name)
                elif office_slug == "county-council-member" and "at-large" in district_name.lower():
                    current_office_has_districts = True
                    append_contest(current_jurisdiction_slug, "county-council-at-large", None)

    flush_countywide_office()

    return contests


def parse_contests_from_sbe(soup: BeautifulSoup, jurisdiction_map: dict) -> list[ContestRecord]:
    """
    Parse contest records from SBE HTML.

    Preferred path: parse the live 2026 local-candidate page, which is
    organized with jurisdiction/office/district headings rather than tables.

    Fallback path: parse an older table-based listing if Maryland changes the
    site back to that format.
    """
    contests = parse_live_candidate_page(soup, jurisdiction_map)
    if contests:
        return contests

    log.warning("Heading-based parser found no contests; falling back to table parser.")

    # Older fallback format:
    # Office | Jurisdiction | District | Election Type | Date

    # Try to find contest data in tables
    tables = soup.find_all("table")
    log.info(f"Found {len(tables)} tables on SBE page")

    for table in tables:
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue

        # Detect header row
        headers = [th.get_text(strip=True).lower() for th in rows[0].find_all(["th", "td"])]
        if not any(kw in " ".join(headers) for kw in ["office", "race", "contest"]):
            continue

        log.info(f"Parsing contest table with headers: {headers}")

        for row in rows[1:]:
            cells = row.find_all("td")
            if len(cells) < 2:
                continue

            cell_texts = [c.get_text(strip=True) for c in cells]

            # Best-effort column mapping — adjust indices after inspecting the real page
            office_text = cell_texts[0] if len(cell_texts) > 0 else ""
            jurisdiction_text = cell_texts[1] if len(cell_texts) > 1 else ""
            district_text = cell_texts[2] if len(cell_texts) > 2 else ""
            election_type_text = cell_texts[3] if len(cell_texts) > 3 else "primary"

            office_slug = match_office_slug(office_text)
            if not office_slug:
                log.debug(f"Unrecognized office: '{office_text}' — skipping")
                continue

            jurisdiction_slug = match_jurisdiction_slug(jurisdiction_text, jurisdiction_map)
            if not jurisdiction_slug:
                log.warning(f"Unrecognized jurisdiction: '{jurisdiction_text}' — skipping")
                continue

            election_type = normalize_election_type(election_type_text)
            district_name = district_text.strip() if district_text.strip() else None

            contests.append(ContestRecord(
                office_slug=office_slug,
                office_name=get_office_name(office_slug),
                jurisdiction_slug=jurisdiction_slug,
                district_name=district_name,
                election_type=election_type,
                election_date=ELECTION_DATES[election_type],
            ))

    return contests

def get_office_name(slug: str) -> str:
    for office in KNOWN_OFFICES:
        if office["slug"] == slug:
            return office["name"]
    return slug.replace("-", " ").title()


def match_jurisdiction_slug(text: str, jurisdiction_map: dict) -> Optional[str]:
    normalized = slugify(text)
    # Direct match
    if normalized in jurisdiction_map:
        return normalized
    # Partial match
    for slug in jurisdiction_map:
        if normalized in slug or slug in normalized:
            return slug
    return None


def normalize_election_type(text: str) -> str:
    text_lower = text.lower()
    if "general" in text_lower:
        return "general"
    if "special" in text_lower:
        return "special"
    return "primary"


# ---------------------------------------------------------------------------
# Database operations
# ---------------------------------------------------------------------------

def upsert_offices(supabase, contest_records: list[ContestRecord]) -> dict[str, str]:
    """
    Upsert all unique offices from the contest records.
    Returns a mapping of office_slug → office_id.
    """
    seen_slugs = set()
    offices_to_upsert = []

    for contest in contest_records:
        if contest.office_slug not in seen_slugs:
            seen_slugs.add(contest.office_slug)
            offices_to_upsert.append({
                "slug": contest.office_slug,
                "name": contest.office_name,
            })

    # Also upsert all KNOWN_OFFICES so office explainers can be generated later
    for office in KNOWN_OFFICES:
        if office["slug"] not in seen_slugs:
            seen_slugs.add(office["slug"])
            offices_to_upsert.append({
                "slug": office["slug"],
                "name": office["name"],
            })

    if offices_to_upsert:
        result = supabase.table("offices").upsert(
            offices_to_upsert, on_conflict="slug"
        ).execute()
        log.info(f"Upserted {len(offices_to_upsert)} offices")

    # Fetch back all office IDs
    result = supabase.table("offices").select("id, slug").execute()
    return {row["slug"]: row["id"] for row in result.data}


def upsert_contests(
    supabase,
    contest_records: list[ContestRecord],
    office_map: dict[str, str],
    jurisdiction_map: dict[str, str],
) -> int:
    rows_to_upsert = []

    for record in contest_records:
        office_id = office_map.get(record.office_slug)
        jurisdiction_id = jurisdiction_map.get(record.jurisdiction_slug)

        if not office_id or not jurisdiction_id:
            log.warning(
                f"Missing office or jurisdiction for contest: "
                f"{record.office_slug} / {record.jurisdiction_slug}"
            )
            continue

        slug = make_contest_slug(
            record.jurisdiction_slug,
            record.office_slug,
            record.district_name,
            record.election_type,
        )

        rows_to_upsert.append({
            "slug": slug,
            "office_id": office_id,
            "jurisdiction_id": jurisdiction_id,
            "district_name": record.district_name,
            "election_date": record.election_date,
            "election_type": record.election_type,
            "seats_available": record.seats_available,
            "sbe_contest_id": record.sbe_contest_id,
        })

    if rows_to_upsert:
        supabase.table("contests").upsert(
            rows_to_upsert, on_conflict="slug"
        ).execute()
        log.info(f"Upserted {len(rows_to_upsert)} contests")

    return len(rows_to_upsert)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def ingest_contests() -> dict:
    supabase = get_client()

    # Load jurisdiction map
    result = supabase.table("jurisdictions").select("id, slug").execute()
    jurisdiction_map: dict[str, str] = {row["slug"]: row["id"] for row in result.data}
    log.info(f"Loaded {len(jurisdiction_map)} jurisdictions")

    if not jurisdiction_map:
        raise RuntimeError("No jurisdictions found. Run seed_jurisdictions.sql first.")

    # Fetch SBE page
    soup = fetch_sbe_page()

    contest_records = []

    if soup:
        contest_records = parse_contests_from_sbe(soup, jurisdiction_map)
        log.info(f"Parsed {len(contest_records)} contests from SBE page")
    else:
        log.warning(
            "Could not fetch SBE offices page. "
            "The 2026 page may not be live yet, or the URL may have changed.\n"
            "Proceeding to upsert known offices only (no contests).\n"
            "Re-run this script once the SBE publishes the 2026 race list."
        )

    # Upsert offices (always — so office explainers can be generated in Stage 3)
    office_map = upsert_offices(supabase, contest_records)

    # Upsert contests (if any were parsed)
    contests_upserted = 0
    if contest_records:
        contests_upserted = upsert_contests(
            supabase, contest_records, office_map, jurisdiction_map
        )

    summary = {
        "contests_parsed": len(contest_records),
        "contests_upserted": contests_upserted,
        "offices_available": len(office_map),
    }

    log.info(f"Summary: {summary}")

    if contests_upserted == 0:
        log.warning(
            "\nNo contests were upserted. Next steps:\n"
            "  1. Check that the SBE 2026 offices page is live\n"
            "  2. Inspect the page HTML and update parse_contests_from_sbe() selectors\n"
            "  3. Or manually INSERT contest rows using the Supabase SQL editor\n"
            "     (use database/schema.sql as reference for the contests table structure)"
        )

    return summary


if __name__ == "__main__":
    log.info("=== ingest_contests.py ===")
    try:
        summary = ingest_contests()
        log.info("Done.")
        sys.exit(0)
    except Exception as e:
        log.error(f"Fatal error: {e}")
        sys.exit(1)
