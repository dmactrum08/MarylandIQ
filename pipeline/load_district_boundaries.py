"""
load_district_boundaries.py

Stage 1 script — builds the precinct_contests mapping for DISTRICT-level
races (county council, commissioners, Board of Ed districts, etc.) using
Maryland SBE election results CSVs.

WHY NOT ArcGIS:
    MD_PoliticalBoundaries on mdgeodata.md.gov has: State boundary, County
    boundaries, Municipal boundaries, and Zip codes. No county council or
    commissioner district polygon layers exist on iMAP.

    We don't need them. The SBE publishes election results broken down by
    precinct AND by contest. That CSV data is the authoritative source for
    exactly which precincts participated in which district-level contest —
    no polygon intersection required.

SOURCE:
    Maryland SBE election results CSV files, available at:
    https://elections.maryland.gov/elections/2022/election_data/index.html

    Specifically the "Precinct Level Election Results" files — one per county.
    These are tab-delimited or comma-delimited files with columns:
        Election Name | Office Name | District | Candidate Name | Party |
        Jurisdiction Name | Precinct Name | Election Night Votes | ...

    We use the 2022 general election results to build the mapping because:
    - 2022 reflects post-redistricting boundaries (same as 2026)
    - All 24 jurisdictions are covered
    - The precinct codes in the CSV match the SBE's own precinct identifiers

ALTERNATIVE FOR JURISDICTIONS WITH NEW DISTRICTS:
    If a county created new council districts after 2022, the SBE will publish
    updated precinct assignment data before the 2026 primary. Check:
    https://elections.maryland.gov/elections/2026/election_data/index.html
    and use the 2026 files when they become available.

Usage:
    python -m pipeline.load_district_boundaries

Run AFTER:
    1. load_precinct_boundaries.py  (precincts must be in DB)
    2. ingest_contests.py           (contests must be in DB)
"""

import csv
import io
import logging
import re
import sys
import time
from dataclasses import dataclass
import requests

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

SBE_RESULTS_BASE = "https://elections.maryland.gov/elections/archive/2022/election_data"

JURISDICTION_DISPLAY_NAMES = {
    "allegany-county": "Allegany County",
    "anne-arundel-county": "Anne Arundel County",
    "baltimore-city": "Baltimore City",
    "baltimore-county": "Baltimore County",
    "calvert-county": "Calvert County",
    "caroline-county": "Caroline County",
    "carroll-county": "Carroll County",
    "cecil-county": "Cecil County",
    "charles-county": "Charles County",
    "dorchester-county": "Dorchester County",
    "frederick-county": "Frederick County",
    "garrett-county": "Garrett County",
    "harford-county": "Harford County",
    "howard-county": "Howard County",
    "kent-county": "Kent County",
    "montgomery-county": "Montgomery County",
    "prince-georges-county": "Prince George's County",
    "queen-annes-county": "Queen Anne's County",
    "saint-marys-county": "Saint Mary's County",
    "somerset-county": "Somerset County",
    "talbot-county": "Talbot County",
    "washington-county": "Washington County",
    "wicomico-county": "Wicomico County",
    "worcester-county": "Worcester County",
}

JURISDICTION_RESULTS_CODES = {
    "allegany-county": "01",
    "anne-arundel-county": "02",
    "baltimore-city": "03",
    "baltimore-county": "04",
    "calvert-county": "05",
    "caroline-county": "06",
    "carroll-county": "07",
    "cecil-county": "08",
    "charles-county": "09",
    "dorchester-county": "10",
    "frederick-county": "11",
    "garrett-county": "12",
    "harford-county": "13",
    "howard-county": "14",
    "kent-county": "15",
    "montgomery-county": "16",
    "prince-georges-county": "17",
    "queen-annes-county": "18",
    "saint-marys-county": "19",
    "somerset-county": "20",
    "talbot-county": "21",
    "washington-county": "22",
    "wicomico-county": "23",
    "worcester-county": "24",
}

REQUEST_TIMEOUT = 30
REQUEST_DELAY = 1.0


@dataclass
class PrecinctContestMapping:
    """A precinct that voted on a specific district contest."""
    jurisdiction_slug: str
    precinct_code_raw: str   # as it appears in the SBE CSV
    office_name: str
    district: str            # e.g. "4", "District 4", "04"


# ---------------------------------------------------------------------------
# SBE CSV parsing
# ---------------------------------------------------------------------------

def build_precinct_results_url(results_code: str) -> str:
    return f"{SBE_RESULTS_BASE}/GG22_{results_code}PrecinctsResults.csv"


def fetch_county_results(url: str, display_name: str) -> list[dict]:
    """Download and parse a county's precinct results CSV."""
    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT, headers={
            "User-Agent": "MarylandIQ/1.0 (voter information platform)"
        })
        resp.raise_for_status()
    except requests.HTTPError as e:
        log.warning(f"  HTTP error for {display_name}: {e} — URL: {url}")
        return []
    except requests.RequestException as e:
        log.warning(f"  Request failed for {display_name}: {e}")
        return []

    content = resp.text
    if "<!doctype html" in content[:200].lower():
        log.warning(f"  Expected CSV but received HTML for {display_name}: {url}")
        return []

    delimiter = "\t" if "\t" in content[:500] else ","

    reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)
    rows = list(reader)
    log.info(f"  {display_name}: {len(rows)} rows, fields: {reader.fieldnames}")
    return rows


def extract_district_mappings(
    rows: list[dict],
    jurisdiction_slug: str,
) -> list[PrecinctContestMapping]:
    """
    From a county's CSV rows, extract mappings for district-level contests only.
    We identify district contests by the presence of a non-null District field
    combined with an office name that matches county-level district races.
    """
    mappings = []
    seen = set()  # deduplicate (precinct, office, district) combinations

    for row in rows:
        # 2022 general precinct files use:
        #   - Office Name
        #   - Office District
        #   - Election District - Precinct
        # Keep fallbacks for format drift.
        office = (
            row.get("Office Name") or row.get("OfficeName") or
            row.get("Office") or ""
        ).strip()

        district = (
            row.get("Office District") or
            row.get("District") or
            row.get("DistrictNumber") or
            row.get("District Number") or ""
        ).strip()

        precinct = (
            row.get("Election District - Precinct") or
            row.get("Precinct") or
            row.get("Precinct Name") or
            row.get("PrecinctName") or
            row.get("Precinct Code") or ""
        ).strip()

        if not office or not precinct:
            continue

        # Only care about district-level county races
        # Skip: statewide offices, federal offices, non-county races
        if not _is_county_district_office(office):
            continue

        # Skip county-wide races (no district)
        if not district or district in ("", "0", "00", "At-Large"):
            continue

        key = (jurisdiction_slug, precinct, office, district)
        if key in seen:
            continue
        seen.add(key)

        mappings.append(PrecinctContestMapping(
            jurisdiction_slug=jurisdiction_slug,
            precinct_code_raw=precinct,
            office_name=office,
            district=district,
        ))

    return mappings


COUNTY_DISTRICT_OFFICE_KEYWORDS = [
    "county council",
    "council member",
    "council district",
    "commissioner",
    "board of education",
    "board of ed",
    "school board",
]


def _is_county_district_office(office_name: str) -> bool:
    name = office_name.lower()
    return any(kw in name for kw in COUNTY_DISTRICT_OFFICE_KEYWORDS)


def normalize_district(raw: str) -> str:
    """Normalize district strings to match our contests.district_name format."""
    raw = raw.strip()
    # Strip leading zeros: "04" → "4"
    try:
        return str(int(raw))
    except ValueError:
        pass
    # "District 4" → "4"
    if raw.lower().startswith("district "):
        return raw[9:].strip()
    return raw


def normalize_office_name(raw: str) -> str:
    """Normalize office labels so SBE result files can match contests reliably."""
    text = raw.lower().strip()
    text = text.replace("&", "and")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    text = text.strip()

    # Harmonize SBE result labels with our contest office names.
    replacements = {
        "county council": "county council member",
        "board of education": "board of education member",
        "board of ed": "board of education member",
        "school board": "board of education member",
        "county commissioners": "county commissioner",
        "county commissioner": "county commissioner",
    }

    return replacements.get(text, text)


def normalize_precinct_token(raw: str) -> str:
    """Normalize precinct identifiers such as '21-017', '21-17', or '001'."""
    text = raw.strip()
    text = re.sub(r"\s+", "", text)
    if not text:
        return ""

    match = re.search(r"(\d{1,2})-(\d{1,3})", text)
    if match:
        district = match.group(1).zfill(2)
        precinct = match.group(2).zfill(3)
        return f"{district}-{precinct}"

    match = re.search(r"(\d{1,2})[^\d]+(\d{1,3})", text)
    if match:
        district = match.group(1).zfill(2)
        precinct = match.group(2).zfill(3)
        return f"{district}-{precinct}"

    if text.isdigit():
        return text.zfill(3 if len(text) <= 3 else len(text))

    return text


# ---------------------------------------------------------------------------
# Database matching
# ---------------------------------------------------------------------------

def build_precinct_lookup(precinct_rows: list[dict]) -> dict[str, str]:
    """Build a flexible precinct-code lookup for one jurisdiction."""
    lookup: dict[str, str] = {}

    for row in precinct_rows:
        precinct_id = row["id"]
        precinct_code = str(row["precinct_code"]).strip()
        if not precinct_code:
            continue

        candidates = {precinct_code}

        if len(precinct_code) > 5:
            # Maryland VTD values are usually county GEOID + district/precinct.
            candidates.add(precinct_code[5:])

        suffix = precinct_code.split("-")[-1]
        candidates.add(suffix)

        if suffix.isdigit():
            candidates.add(str(int(suffix)))
            candidates.add(suffix.zfill(6))

        normalized_candidates = {normalize_precinct_token(candidate) for candidate in candidates}
        normalized_candidates.discard("")

        for candidate in candidates | normalized_candidates:
            if candidate:
                lookup.setdefault(candidate, precinct_id)

    return lookup


def find_precinct_id(precinct_lookup: dict[str, str], precinct_code_raw: str) -> str | None:
    """Look up a precinct by the raw code from the SBE CSV."""
    raw = precinct_code_raw.strip()
    if not raw:
        return None

    candidates = {raw, normalize_precinct_token(raw)}
    if raw.isdigit():
        candidates.add(str(int(raw)))
        candidates.add(raw.zfill(6))

    for candidate in candidates:
        if candidate in precinct_lookup:
            return precinct_lookup[candidate]

    return None


def build_contest_lookup(contest_rows: list[dict]) -> dict[tuple[str, str], str]:
    """Index contests by normalized office name and normalized district."""
    lookup: dict[tuple[str, str], str] = {}

    for row in contest_rows:
        district_name = row.get("district_name")
        office_name = row.get("office_name")
        if not district_name or not office_name:
            continue

        key = (
            normalize_office_name(office_name),
            normalize_district(district_name),
        )
        lookup.setdefault(key, row["id"])

    return lookup


def find_contest_id(
    contest_lookup: dict[tuple[str, str], str],
    office_name: str,
    district: str,
) -> str | None:
    """Find a contest matching both office name and district."""
    key = (normalize_office_name(office_name), normalize_district(district))
    return contest_lookup.get(key)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def load_district_boundaries() -> dict:
    supabase = get_client()

    # Load jurisdiction map
    result = supabase.table("jurisdictions").select("id, slug").execute()
    jurisdiction_map: dict[str, str] = {row["slug"]: row["id"] for row in result.data}

    office_rows = supabase.table("offices").select("id, name").execute().data
    office_name_by_id = {row["id"]: row["name"] for row in office_rows}

    contest_rows = supabase.table("contests").select(
        "id, jurisdiction_id, office_id, district_name"
    ).execute().data

    contests_by_jurisdiction: dict[str, list[dict]] = {}
    for row in contest_rows:
        office_name = office_name_by_id.get(row["office_id"])
        if not office_name or not row.get("district_name"):
            continue

        normalized_row = {
            "id": row["id"],
            "jurisdiction_id": row["jurisdiction_id"],
            "district_name": row["district_name"],
            "office_name": office_name,
        }
        contests_by_jurisdiction.setdefault(row["jurisdiction_id"], []).append(normalized_row)

    total_mappings = 0
    total_unmatched_precincts = 0
    total_unmatched_contests = 0
    counties_processed = 0
    unmatched_precinct_examples: dict[str, list[str]] = {}
    unmatched_contest_examples: dict[str, list[str]] = {}

    for jurisdiction_slug, display_name in JURISDICTION_DISPLAY_NAMES.items():
        jurisdiction_id = jurisdiction_map.get(jurisdiction_slug)
        if not jurisdiction_id:
            log.warning(f"Jurisdiction not found in DB: {jurisdiction_slug}")
            continue

        results_code = JURISDICTION_RESULTS_CODES.get(jurisdiction_slug)
        if not results_code:
            log.warning(f"No precinct-results code found for {display_name}")
            time.sleep(REQUEST_DELAY)
            continue

        url = build_precinct_results_url(results_code)

        log.info(f"Processing {jurisdiction_slug} ({display_name})...")
        rows = fetch_county_results(url, display_name)

        if not rows:
            log.warning(f"  No data returned for {display_name}")
            time.sleep(REQUEST_DELAY)
            continue

        counties_processed += 1
        precinct_rows = (
            supabase.table("precincts")
            .select("id, precinct_code")
            .eq("jurisdiction_id", jurisdiction_id)
            .execute()
        ).data
        precinct_lookup = build_precinct_lookup(precinct_rows)
        contest_lookup = build_contest_lookup(
            contests_by_jurisdiction.get(jurisdiction_id, [])
        )

        mappings = extract_district_mappings(rows, jurisdiction_slug)
        log.info(f"  Found {len(mappings)} district precinct-contest pairs")

        rows_to_insert = []

        for mapping in mappings:
            precinct_id = find_precinct_id(precinct_lookup, mapping.precinct_code_raw)
            if not precinct_id:
                log.debug(
                    f"  No precinct match: {mapping.precinct_code_raw} "
                    f"in {jurisdiction_slug}"
                )
                total_unmatched_precincts += 1
                examples = unmatched_precinct_examples.setdefault(jurisdiction_slug, [])
                if len(examples) < 5 and mapping.precinct_code_raw not in examples:
                    examples.append(mapping.precinct_code_raw)
                continue

            contest_id = find_contest_id(contest_lookup, mapping.office_name, mapping.district)
            if not contest_id:
                log.debug(
                    f"  No contest match: {mapping.office_name} "
                    f"district={mapping.district} in {jurisdiction_slug}"
                )
                total_unmatched_contests += 1
                examples = unmatched_contest_examples.setdefault(jurisdiction_slug, [])
                sample = f"{mapping.office_name} | {mapping.district}"
                if len(examples) < 5 and sample not in examples:
                    examples.append(sample)
                continue

            rows_to_insert.append({
                "precinct_id": precinct_id,
                "contest_id": contest_id,
            })

        if rows_to_insert:
            # Deduplicate before upsert
            seen = set()
            deduped = []
            for r in rows_to_insert:
                key = (r["precinct_id"], r["contest_id"])
                if key not in seen:
                    seen.add(key)
                    deduped.append(r)

            for i in range(0, len(deduped), 500):
                batch = deduped[i:i + 500]
                supabase.table("precinct_contests").upsert(
                    batch, on_conflict="precinct_id,contest_id"
                ).execute()
                total_mappings += len(batch)

            log.info(f"  Inserted {len(deduped)} precinct_contests rows")

        time.sleep(REQUEST_DELAY)

    summary = {
        "counties_processed": counties_processed,
        "precinct_contest_rows_inserted": total_mappings,
        "unmatched_precincts": total_unmatched_precincts,
        "unmatched_contests": total_unmatched_contests,
    }

    if total_unmatched_precincts > 0 or total_unmatched_contests > 0:
        log.warning(
            f"\nUnmatched records detected. This is expected on first run if:\n"
            f"  - The SBE CSV precinct codes use different formatting than TIGER\n"
            f"  - contests table is not yet populated (run ingest_contests.py first)\n"
            f"\nSample unmatched precinct values by county: {unmatched_precinct_examples}"
            f"\nSample unmatched contest values by county: {unmatched_contest_examples}"
        )

    return summary


if __name__ == "__main__":
    log.info("=== load_district_boundaries.py ===")
    log.info("Source: Maryland SBE precinct-level election results CSVs (2022)")
    log.info(
        "Note: This script requires the 2022 results CSVs to be accessible at "
        "elections.maryland.gov. If URLs have changed, update SBE_RESULTS_BASE "
        "and ELECTION_SUFFIX at the top of this file."
    )

    try:
        summary = load_district_boundaries()
        log.info(f"Done. Summary: {summary}")
        sys.exit(0)
    except Exception as e:
        log.error(f"Fatal error: {e}")
        raise
