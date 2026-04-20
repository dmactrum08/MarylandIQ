"""
seed_incumbents.py

Sets is_incumbent = true on candidates who currently hold the seat they are
running for in 2026.

Sources
-------
  MGA roster     Maryland General Assembly member pages (Senate + House)
                 Covers: State Senator, House of Delegates Member
  Hardcoded      Statewide and federal offices where the incumbent is
                 unambiguous (Governor, AG, Comptroller, U.S. Senator)
  Manual JSON    pipeline/data/county_incumbents.json — hand-maintained list
                 for county-level offices (no central authoritative source
                 exists). A template is created on first run if the file is
                 missing.

Matching strategy
-----------------
For each known incumbent we:
  1. Locate the contest(s) for that office + district in the candidates table.
  2. Fuzzy-match the incumbent's name against candidates in those contests
     using difflib (threshold 0.82).
  3. If a single confident match is found, mark is_incumbent = true.

Flags
-----
  --dry-run   (default) Print matches without writing to the database.
  --apply     Write changes.
  --threshold FLOAT   Override the fuzzy-match threshold (default 0.82).

Usage
-----
  python -m pipeline.seed_incumbents           # dry run
  python -m pipeline.seed_incumbents --apply   # write to DB
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional

import re
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

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REQUEST_TIMEOUT = 20
REQUEST_DELAY = 1.0

MGA_SENATE_URL = "https://mgaleg.maryland.gov/mgawebsite/Members/Index/senate"
MGA_HOUSE_URL = "https://mgaleg.maryland.gov/mgawebsite/Members/Index/house"

DATA_DIR = Path(__file__).parent / "data"
COUNTY_INCUMBENTS_FILE = DATA_DIR / "county_incumbents.json"

COUNTY_INCUMBENTS_TEMPLATE = {
    "_instructions": (
        "Add one entry per incumbent. 'office_slug' must match a slug in your "
        "offices table (e.g. 'county-executive', 'county-council-member', "
        "'sheriff', 'states-attorney', 'board-of-education', etc.). "
        "'district_name' should match the district_name in your contests table "
        "exactly, or null for county-wide offices. "
        "'jurisdiction_slug' must match a slug in your jurisdictions table."
    ),
    "incumbents": [
        {
            "full_name": "Jane Smith",
            "office_slug": "county-executive",
            "jurisdiction_slug": "montgomery-county",
            "district_name": None,
        },
        {
            "full_name": "John Doe",
            "office_slug": "county-council-member",
            "jurisdiction_slug": "prince-georges-county",
            "district_name": "District 3",
        },
    ],
}

# Statewide / federal incumbents as of the 2026 cycle.
# Update this list each election cycle.
STATEWIDE_INCUMBENTS: list[dict] = [
    # Statewide — update each cycle
    {"full_name": "Wes Moore",                     "office_slug": "governor",          "jurisdiction_slug": "maryland-statewide", "district_name": None},
    {"full_name": "Anthony Brown",                  "office_slug": "attorney-general",  "jurisdiction_slug": "maryland-statewide", "district_name": None},
    # Use full legal name as filed in SBE to guarantee fuzzy match
    {"full_name": "Brooke Elizabeth Lierman",       "office_slug": "comptroller",       "jurisdiction_slug": "maryland-statewide", "district_name": None},
    # U.S. Senate — Class III seat; Alsobrooks won 2024
    {"full_name": "Angela Alsobrooks",              "office_slug": "us-senator",        "jurisdiction_slug": "maryland-statewide", "district_name": None},
    # U.S. House — update after each general election
    # CD1  Andy Harris (R) re-elected 2024
    {"full_name": "Andy Harris",                    "office_slug": "us-representative", "jurisdiction_slug": "maryland-statewide", "district_name": "Congressional District 1"},
    # CD2  John Olszewski Jr. (D) won 2024 open seat (Ruppersberger retired)
    {"full_name": 'John "Johnny O" Olszewski, Jr.', "office_slug": "us-representative", "jurisdiction_slug": "maryland-statewide", "district_name": "Congressional District 2"},
    # CD3  Sarah Elfreth (D) won 2024
    {"full_name": "Sarah Elfreth",                  "office_slug": "us-representative", "jurisdiction_slug": "maryland-statewide", "district_name": "Congressional District 3"},
    # CD4  Glenn Ivey (D) re-elected 2024 — use full name as filed
    {"full_name": "Glenn F. Ivey",                  "office_slug": "us-representative", "jurisdiction_slug": "maryland-statewide", "district_name": "Congressional District 4"},
    # CD5  open seat — Hoyer retired 2023; verify current holder and uncomment
    # {"full_name": "TODO",                         "office_slug": "us-representative", "jurisdiction_slug": "maryland-statewide", "district_name": "Congressional District 5"},
    # CD6  April McClain Delaney (D) won 2024 (Trone gave up seat for Senate run)
    {"full_name": "April McClain Delaney",          "office_slug": "us-representative", "jurisdiction_slug": "maryland-statewide", "district_name": "Congressional District 6"},
    # CD7  Kweisi Mfume (D) re-elected 2024
    {"full_name": "Kweisi Mfume",                   "office_slug": "us-representative", "jurisdiction_slug": "maryland-statewide", "district_name": "Congressional District 7"},
    # CD8  Jamie Raskin (D) re-elected 2024
    {"full_name": "Jamie Raskin",                   "office_slug": "us-representative", "jurisdiction_slug": "maryland-statewide", "district_name": "Congressional District 8"},
]


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class IncumbentRecord:
    full_name: str
    office_slug: str
    jurisdiction_slug: str
    district_name: Optional[str]
    source: str  # 'mga_senate' | 'mga_house' | 'statewide' | 'county_json'


# ---------------------------------------------------------------------------
# Name normalization helpers
# ---------------------------------------------------------------------------

def normalize_name(name: str) -> str:
    """Lowercase, strip punctuation (including quotes), collapse whitespace."""
    name = name.lower().strip()
    name = re.sub(r"""[.,\-'""\u201c\u201d]""", " ", name)  # remove all quote/punct variants
    name = re.sub(r"\s+", " ", name)
    return name.strip()


def name_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, normalize_name(a), normalize_name(b)).ratio()


def best_name_match(
    incumbent_name: str,
    candidates: list[dict],
    threshold: float,
) -> Optional[dict]:
    """
    Return the candidate dict with the highest name similarity above threshold,
    or None if no match clears the bar.
    """
    scored = [
        (name_similarity(incumbent_name, c["full_name"]), c)
        for c in candidates
    ]
    scored.sort(key=lambda x: x[0], reverse=True)
    if scored and scored[0][0] >= threshold:
        return scored[0][1]
    return None


# ---------------------------------------------------------------------------
# MGA scraping
# ---------------------------------------------------------------------------

def _fetch_mga_page(url: str) -> Optional[BeautifulSoup]:
    try:
        resp = requests.get(
            url,
            timeout=REQUEST_TIMEOUT,
            headers={"User-Agent": "MarylandIQ/1.0 (voter information platform; contact@marylandiq.com)"},
        )
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")
    except requests.RequestException as e:
        log.error("Failed to fetch %s: %s", url, e)
        return None


def _parse_mga_district(raw: str) -> Optional[str]:
    """
    Extract the district identifier from any MGA district string.
    Returns just the number+letter token, e.g. '41', '7B', '33C'.
    The calling code adds the appropriate prefix for DB matching.
    """
    m = re.search(r"District\s+([0-9]+[A-Za-z]?)", raw, re.IGNORECASE)
    if m:
        return m.group(1).upper()
    return None


def _district_name_variants(token: str, office_slug: str) -> list[Optional[str]]:
    """
    Return all district_name formats we might have stored in contests for
    this office.  The SBE CSV column 'Contest Run By District Name and Number'
    can produce values like 'Legislative District 41' or
    'Congressional District 3', but our normalize_district_name() function
    may have simplified them.  Try every plausible variant so a mismatch in
    prefix doesn't block a match.
    """
    if office_slug in ("state-senator", "house-of-delegates-member"):
        return [
            f"Legislative District {token}",
            f"District {token}",
        ]
    if office_slug == "us-representative":
        return [
            f"Congressional District {token}",
            f"District {token}",
        ]
    return [f"District {token}"]


# Leadership titles MGA inserts between the name and the district text.
# These appear in the cell when a member holds a chamber leadership role.
_MGA_TITLE_PATTERNS = [
    r"President of the Senate",
    r"President Pro Tem",
    r"Speaker of the House",
    r"Speaker Pro Tem",
    r"Majority Leader",
    r"Majority Whip",
    r"Minority Leader",
    r"Minority Whip",
    r"Speaker",
]
_MGA_TITLE_RE = re.compile(
    r"\s*\b(?:" + "|".join(_MGA_TITLE_PATTERNS) + r")\b\s*",
    re.IGNORECASE,
)


def _parse_mga_name(cell_text: str) -> Optional[str]:
    """
    Extract and normalize a member name from full MGA cell text.

    MGA cell text formats:
      Normal:    'Attar, Dalya District 41 Baltimore City Democrat'
      Leadership:'Ferguson, Bill President of the Senate District 46 ...'
                 'Hershey, Stephen S., Jr. Minority Leader District 36 ...'

    Steps:
      1. Split on first 'District <digit>' to isolate the name+title portion
      2. Strip any leadership title
      3. Convert 'Last, First [Middle]' → 'First [Middle] Last'
    """
    # 1. Everything before "District N..."
    name_part = re.split(r"\bDistrict\s+\d", cell_text, maxsplit=1)[0].strip().rstrip(",").strip()
    if not name_part:
        return None

    # 2. Remove leadership title if present
    name_part = _MGA_TITLE_RE.sub(" ", name_part).strip()

    # 3. "Last, First [Middle [Suffix]]" → "First [Middle [Suffix]] Last"
    if "," in name_part:
        last, _, rest = name_part.partition(",")
        first_parts = rest.strip()
        return f"{first_parts} {last.strip()}".strip()

    return name_part


def scrape_mga_members(url: str, office_slug: str) -> list[IncumbentRecord]:
    """
    Scrape a single MGA member-index page and return IncumbentRecord objects.

    The MGA page renders member cards as <div class="p-0 member-index-cell">.
    The <a> tag wraps the entire card, so we pull the full cell text and parse
    name + district from it rather than relying on tag structure.
    """
    source_label = "mga_senate" if "senate" in url else "mga_house"
    log.info("Fetching MGA page: %s", url)
    soup = _fetch_mga_page(url)
    if not soup:
        return []

    records: list[IncumbentRecord] = []

    cells = soup.select("div.p-0.member-index-cell, div.member-index-cell")
    if not cells:
        cells = soup.select("#myDIV > div")

    log.info("  Found %d member cells", len(cells))

    for cell in cells:
        cell_text = cell.get_text(" ", strip=True)
        if not cell_text:
            continue

        full_name = _parse_mga_name(cell_text)
        if not full_name:
            log.debug("  Could not parse name from: %r", cell_text[:80])
            continue

        district_token = _parse_mga_district(cell_text)
        if not district_token:
            log.debug("  No district found in: %r", cell_text[:80])
            continue

        # Store all format variants; find_match will try each
        district_variants = _district_name_variants(district_token, office_slug)

        records.append(IncumbentRecord(
            full_name=full_name,
            office_slug=office_slug,
            jurisdiction_slug="maryland-statewide",
            district_name=district_variants[0],   # primary variant stored on record
            source=source_label,
        ))
        # Attach extras so find_match can try them
        records[-1].__dict__["_district_variants"] = district_variants

    log.info("  Parsed %d incumbent records from %s", len(records), source_label)
    return records


# ---------------------------------------------------------------------------
# County JSON loader
# ---------------------------------------------------------------------------

def load_county_incumbents() -> list[IncumbentRecord]:
    if not COUNTY_INCUMBENTS_FILE.exists():
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        COUNTY_INCUMBENTS_FILE.write_text(
            json.dumps(COUNTY_INCUMBENTS_TEMPLATE, indent=2), encoding="utf-8"
        )
        log.info(
            "Created template at %s — fill it in and re-run to seed county incumbents.",
            COUNTY_INCUMBENTS_FILE,
        )
        return []

    raw = json.loads(COUNTY_INCUMBENTS_FILE.read_text(encoding="utf-8"))
    incumbents = raw.get("incumbents", [])

    records = []
    for entry in incumbents:
        name = (entry.get("full_name") or "").strip()
        office = (entry.get("office_slug") or "").strip()
        jurisdiction = (entry.get("jurisdiction_slug") or "").strip()
        if not name or not office or not jurisdiction:
            log.warning("Skipping incomplete county incumbent entry: %s", entry)
            continue
        records.append(IncumbentRecord(
            full_name=name,
            office_slug=office,
            jurisdiction_slug=jurisdiction,
            district_name=entry.get("district_name"),
            source="county_json",
        ))

    log.info("Loaded %d county incumbent records from JSON", len(records))
    return records


# ---------------------------------------------------------------------------
# Database matching
# ---------------------------------------------------------------------------

def load_candidate_index(supabase) -> list[dict]:
    """
    Load all active candidates with their contest/office/jurisdiction context.
    Returns a flat list of dicts for matching.
    """
    PAGE = 1000
    all_data = []
    offset = 0
    while True:
        result = supabase.table("candidates").select(
            "id, full_name, is_incumbent, filing_status, "
            "contest:contests("
            "  district_name, "
            "  office:offices(slug), "
            "  jurisdiction:jurisdictions(slug)"
            ")"
        ).eq("filing_status", "Active").range(offset, offset + PAGE - 1).execute()
        all_data.extend(result.data)
        if len(result.data) < PAGE:
            break
        offset += PAGE

    rows = []
    for row in all_data:
        contest = row.get("contest")
        if isinstance(contest, list):
            contest = contest[0] if contest else None
        if not contest:
            continue

        office = contest.get("office")
        if isinstance(office, list):
            office = office[0] if office else None
        jurisdiction = contest.get("jurisdiction")
        if isinstance(jurisdiction, list):
            jurisdiction = jurisdiction[0] if jurisdiction else None

        rows.append({
            "id": row["id"],
            "full_name": row["full_name"],
            "is_incumbent": row["is_incumbent"],
            "office_slug": office["slug"] if office else None,
            "jurisdiction_slug": jurisdiction["slug"] if jurisdiction else None,
            "district_name": contest.get("district_name"),
        })

    log.info("Loaded %d active candidates from database", len(rows))
    return rows


def find_match(
    incumbent: IncumbentRecord,
    candidate_index: list[dict],
    threshold: float,
) -> Optional[dict]:
    """
    Filter candidates by office + jurisdiction + district, then fuzzy-match name.
    Tries all district name variants so prefix differences don't block a match.
    """
    # Collect all district variants to try (primary + any extras attached by scraper)
    district_variants: list[Optional[str]] = list(dict.fromkeys(
        [incumbent.district_name] + incumbent.__dict__.get("_district_variants", [])
    ))

    pool: list[dict] = []
    for variant in district_variants:
        pool = [
            c for c in candidate_index
            if c["office_slug"] == incumbent.office_slug
            and c["jurisdiction_slug"] == incumbent.jurisdiction_slug
            and c["district_name"] == variant
        ]
        if pool:
            break

    if not pool:
        log.debug(
            "No candidates in pool for %s / %s / %s (tried variants: %s)",
            incumbent.full_name, incumbent.office_slug,
            incumbent.jurisdiction_slug, district_variants,
        )
        return None

    return best_name_match(incumbent.full_name, pool, threshold)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(apply: bool, threshold: float, debug_pool: Optional[str] = None, debug_mga: bool = False) -> None:
    supabase = get_client()

    # ── 1. Collect all incumbent records ─────────────────────────────────────
    all_incumbents: list[IncumbentRecord] = []

    # Statewide / federal (hardcoded)
    for entry in STATEWIDE_INCUMBENTS:
        rec = IncumbentRecord(
            full_name=entry["full_name"],
            office_slug=entry["office_slug"],
            jurisdiction_slug=entry["jurisdiction_slug"],
            district_name=entry.get("district_name"),
            source="statewide",
        )
        # Attach district variants for fallback matching
        d = entry.get("district_name")
        if d:
            m = re.search(r"(\d+[A-Za-z]?)$", d)
            if m:
                rec.__dict__["_district_variants"] = _district_name_variants(
                    m.group(1).upper(), entry["office_slug"]
                )
        all_incumbents.append(rec)
    log.info("Loaded %d statewide/federal incumbent records", len(STATEWIDE_INCUMBENTS))

    # MGA — State Senate
    senate_records = scrape_mga_members(MGA_SENATE_URL, "state-senator")
    all_incumbents.extend(senate_records)
    time.sleep(REQUEST_DELAY)

    # MGA — House of Delegates
    house_records = scrape_mga_members(MGA_HOUSE_URL, "house-of-delegates-member")
    all_incumbents.extend(house_records)
    time.sleep(REQUEST_DELAY)

    # County JSON
    county_records = load_county_incumbents()
    all_incumbents.extend(county_records)

    log.info("Total incumbent records to match: %d", len(all_incumbents))

    # Debug: dump the raw names+districts parsed from MGA to verify parsing.
    if debug_mga:
        mga_records = [r for r in all_incumbents if r.source in ("mga_senate", "mga_house")]
        log.info("\n--- DEBUG MGA (%d records) ---", len(mga_records))
        for r in mga_records:
            variants = r.__dict__.get("_district_variants", [r.district_name])
            log.info("  [%s] %-40s  district=%r  variants=%s",
                     r.source, r.full_name, r.district_name, variants)
        log.info("--- END DEBUG MGA ---\n")
        return

    # ── 2. Load candidate index ───────────────────────────────────────────────
    candidate_index = load_candidate_index(supabase)

    # Debug: dump the candidate pool for a specific office slug so you can
    # inspect the exact district_name values stored in your database.
    if debug_pool:
        matching = [c for c in candidate_index if c["office_slug"] == debug_pool]
        log.info("\n--- DEBUG POOL for office_slug=%r (%d candidates) ---", debug_pool, len(matching))
        for c in sorted(matching, key=lambda x: (x["district_name"] or "", x["full_name"])):
            log.info("  %-40s  district=%-30s  jurisdiction=%s",
                     c["full_name"], repr(c["district_name"]), c["jurisdiction_slug"])
        log.info("--- END DEBUG POOL ---\n")
        return

    # ── 3. Match and collect updates ─────────────────────────────────────────
    to_mark: list[dict] = []      # candidate dicts to flip to is_incumbent=true
    no_match: list[IncumbentRecord] = []

    for incumbent in all_incumbents:
        match = find_match(incumbent, candidate_index, threshold)
        if match:
            if match["is_incumbent"]:
                log.debug("Already marked: %s", match["full_name"])
            else:
                similarity = name_similarity(incumbent.full_name, match["full_name"])
                log.info(
                    "  MATCH [%.2f] %-30s  →  %-30s  (%s / %s)",
                    similarity,
                    incumbent.full_name,
                    match["full_name"],
                    incumbent.office_slug,
                    incumbent.district_name or "county-wide",
                )
                to_mark.append(match)
        else:
            no_match.append(incumbent)

    # ── 4. Report no-matches ─────────────────────────────────────────────────
    if no_match:
        log.warning(
            "\n%d incumbents had no candidate match (not filed, withdrawn, or "
            "name format differs):",
            len(no_match),
        )
        for inc in no_match:
            log.warning(
                "  %-30s  %s / %s / %s",
                inc.full_name,
                inc.office_slug,
                inc.jurisdiction_slug,
                inc.district_name or "county-wide",
            )

    # ── 5. Apply or dry-run ───────────────────────────────────────────────────
    if not to_mark:
        log.info("No new incumbents to mark.")
        return

    if not apply:
        log.info(
            "\nDRY RUN — would mark %d candidate(s) as incumbent. "
            "Re-run with --apply to write.",
            len(to_mark),
        )
        return

    ids = [c["id"] for c in to_mark]
    # Update in batches of 50 to stay within Supabase URL limits
    batch_size = 50
    updated = 0
    for i in range(0, len(ids), batch_size):
        batch = ids[i : i + batch_size]
        supabase.table("candidates").update({"is_incumbent": True}).in_("id", batch).execute()
        updated += len(batch)

    log.info("Marked %d candidate(s) as incumbent.", updated)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed is_incumbent flags on candidates.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        dest="apply",
        action="store_false",
        default=False,
        help="Print matches without writing (default).",
    )
    mode.add_argument(
        "--apply",
        dest="apply",
        action="store_true",
        help="Write is_incumbent = true to the database.",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.82,
        help="Fuzzy name-match threshold 0–1 (default 0.82).",
    )
    parser.add_argument(
        "--debug-pool",
        metavar="OFFICE_SLUG",
        default=None,
        help=(
            "Print all candidates for an office slug and exit — useful for "
            "inspecting the exact district_name values in your database. "
            "Example: --debug-pool state-senator"
        ),
    )
    parser.add_argument(
        "--debug-mga",
        action="store_true",
        default=False,
        help="Print every name+district parsed from MGA pages and exit, without touching the DB.",
    )
    args = parser.parse_args()

    log.info("=== seed_incumbents.py (apply=%s, threshold=%.2f) ===", args.apply, args.threshold)
    try:
        run(apply=args.apply, threshold=args.threshold, debug_pool=args.debug_pool, debug_mga=args.debug_mga)
        log.info("Done.")
        sys.exit(0)
    except Exception as e:
        log.error("Fatal error: %s", e)
        sys.exit(1)
