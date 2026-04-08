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

# SBE precinct-level results CSV index for 2022 general election.
# Each county has its own file. The index page lists them all.
# We iterate over this list and download each one.
SBE_RESULTS_BASE = "https://elections.maryland.gov/elections/2022/election_data"

# Map our jurisdiction slugs → SBE county name strings (as they appear in CSVs)
# and their results filename prefixes. Adjust if the 2022 filenames differ.
# Pattern: {County_Name}_By_Precinct_Results_{election}.csv
JURISDICTION_SBE_FILES = {
    "allegany-county":       "Allegany",
    "anne-arundel-county":   "Anne_Arundel",
    "baltimore-city":        "Baltimore_City",
    "baltimore-county":      "Baltimore_County",
    "calvert-county":        "Calvert",
    "caroline-county":       "Caroline",
    "carroll-county":        "Carroll",
    "cecil-county":          "Cecil",
    "charles-county":        "Charles",
    "dorchester-county":     "Dorchester",
    "frederick-county":      "Frederick",
    "garrett-county":        "Garrett",
    "harford-county":        "Harford",
    "howard-county":         "Howard",
    "kent-county":           "Kent",
    "montgomery-county":     "Montgomery",
    "prince-georges-county": "Prince_Georges",
    "queen-annes-county":    "Queen_Annes",
    "saint-marys-county":    "Saint_Marys",
    "somerset-county":       "Somerset",
    "talbot-county":         "Talbot",
    "washington-county":     "Washington",
    "wicomico-county":       "Wicomico",
    "worcester-county":      "Worcester",
}

# SBE 2022 general election results filename suffix
# Check the actual index page if this pattern doesn't match
ELECTION_SUFFIX = "General"

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

def build_csv_url(county_prefix: str) -> str:
    """
    Build the URL for a county's precinct-level results CSV.
    Actual URL pattern confirmed from SBE website — adjust if needed.
    """
    return (
        f"{SBE_RESULTS_BASE}/"
        f"{county_prefix}_By_Precinct_Results_{ELECTION_SUFFIX}.csv"
    )


def fetch_county_results(county_prefix: str) -> list[dict]:
    """Download and parse a county's precinct results CSV."""
    url = build_csv_url(county_prefix)

    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT, headers={
            "User-Agent": "MarylandIQ/1.0 (voter information platform)"
        })
        resp.raise_for_status()
    except requests.HTTPError as e:
        log.warning(f"  HTTP error for {county_prefix}: {e} — URL: {url}")
        return []
    except requests.RequestException as e:
        log.warning(f"  Request failed for {county_prefix}: {e}")
        return []

    # SBE CSVs are typically tab-delimited; try both
    content = resp.text
    delimiter = "\t" if "\t" in content[:500] else ","

    reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)
    rows = list(reader)
    log.info(f"  {county_prefix}: {len(rows)} rows, fields: {reader.fieldnames}")
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
        # Field names vary slightly by county; try common variations
        office = (
            row.get("Office Name") or row.get("OfficeName") or
            row.get("Office") or ""
        ).strip()

        district = (
            row.get("District") or row.get("DistrictNumber") or
            row.get("District Number") or ""
        ).strip()

        precinct = (
            row.get("Precinct") or row.get("Precinct Name") or
            row.get("PrecinctName") or row.get("Precinct Code") or ""
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
    return text.strip()


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

        suffix = precinct_code.split("-")[-1]
        candidates = {precinct_code, suffix}

        if suffix.isdigit():
            candidates.add(str(int(suffix)))
            candidates.add(suffix.zfill(6))

        for candidate in candidates:
            lookup.setdefault(candidate, precinct_id)

    return lookup


def find_precinct_id(precinct_lookup: dict[str, str], precinct_code_raw: str) -> str | None:
    """Look up a precinct by the raw code from the SBE CSV."""
    raw = precinct_code_raw.strip()
    if not raw:
        return None

    candidates = {raw}
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

    for jurisdiction_slug, county_prefix in JURISDICTION_SBE_FILES.items():
        jurisdiction_id = jurisdiction_map.get(jurisdiction_slug)
        if not jurisdiction_id:
            log.warning(f"Jurisdiction not found in DB: {jurisdiction_slug}")
            continue

        log.info(f"Processing {jurisdiction_slug} ({county_prefix})...")
        rows = fetch_county_results(county_prefix)

        if not rows:
            log.warning(f"  No data returned for {county_prefix}")
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
                continue

            contest_id = find_contest_id(contest_lookup, mapping.office_name, mapping.district)
            if not contest_id:
                log.debug(
                    f"  No contest match: {mapping.office_name} "
                    f"district={mapping.district} in {jurisdiction_slug}"
                )
                total_unmatched_contests += 1
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
            f"\nTo debug, inspect the actual CSV field names by running:\n"
            f"  python -c \"from pipeline.load_district_boundaries import "
            f"fetch_county_results; r=fetch_county_results('Montgomery'); "
            f"print(r[0] if r else 'empty')\"\n"
            f"\nThen adjust the field names in extract_district_mappings() to match."
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
