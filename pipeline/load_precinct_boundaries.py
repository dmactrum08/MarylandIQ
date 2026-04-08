"""
load_precinct_boundaries.py

Stage 1 script — loads official Maryland 2026 precinct boundaries from
Maryland iMAP / mdgeodata into Supabase PostGIS.

VERIFIED SOURCE:
    https://mdgeodata.md.gov/imap/rest/services/Boundaries/MD_ElectionBoundaries/FeatureServer/2

    Layer name: Maryland Precincts 2026
    Verified on April 8, 2026.

WHY THIS SOURCE:
    Maryland now publishes an official 2026 precinct layer directly on
    mdgeodata, so we no longer need the Census TIGER/Line workaround for
    Stage 1 precinct loading.

IMPORTANT LIMITATION:
    This service solves precinct polygons only. We still have not found
    county council / commissioner district polygon layers on mdgeodata,
    so district-level precinct_contests mapping continues to rely on the
    Maryland SBE precinct-results fallback in load_district_boundaries.py.

Usage:
    python -m pipeline.load_precinct_boundaries

Prerequisites:
    - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set in .env
    - PostGIS enabled on Supabase project
    - jurisdictions table seeded
    - database/schema.sql and database/functions.sql applied
"""

import json
import logging
import sys
import time
from typing import Optional

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

PRECINCT_LAYER_URL = (
    "https://mdgeodata.md.gov/imap/rest/services/Boundaries/"
    "MD_ElectionBoundaries/FeatureServer/2"
)

ARCGIS_PAGE_SIZE = 1000
REQUEST_DELAY_SECONDS = 0.5
OBJECT_ID_BATCH_SIZE = 200

COUNTY_FIPS_TO_SLUG = {
    "001": "allegany-county",
    "003": "anne-arundel-county",
    "005": "baltimore-county",
    "510": "baltimore-city",
    "009": "calvert-county",
    "011": "caroline-county",
    "013": "carroll-county",
    "015": "cecil-county",
    "017": "charles-county",
    "019": "dorchester-county",
    "021": "frederick-county",
    "023": "garrett-county",
    "025": "harford-county",
    "027": "howard-county",
    "029": "kent-county",
    "031": "montgomery-county",
    "033": "prince-georges-county",
    "035": "queen-annes-county",
    "037": "saint-marys-county",
    "039": "somerset-county",
    "041": "talbot-county",
    "043": "washington-county",
    "045": "wicomico-county",
    "047": "worcester-county",
}

VALIDATION_SAMPLES = [
    (38.9897, -76.9378, "prince-georges-county", "Greenbelt — Prince George's County"),
    (39.2904, -76.6122, "baltimore-city", "Baltimore City — downtown"),
    (39.0458, -76.6413, "anne-arundel-county", "Annapolis — Anne Arundel County"),
    (39.1434, -77.2014, "montgomery-county", "Gaithersburg — Montgomery County"),
    (38.6785, -76.0730, "talbot-county", "Easton — Talbot County"),
]


# ---------------------------------------------------------------------------
# ArcGIS fetch helpers
# ---------------------------------------------------------------------------

def fetch_object_ids() -> list[int]:
    response = requests.get(
        f"{PRECINCT_LAYER_URL}/query",
        params={
            "where": "1=1",
            "returnIdsOnly": "true",
            "f": "json",
        },
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    return data.get("objectIds", [])


def fetch_feature_batch(object_ids: list[int]) -> list[dict]:
    response = requests.get(
        f"{PRECINCT_LAYER_URL}/query",
        params={
            "objectIds": ",".join(str(object_id) for object_id in object_ids),
            "outFields": "OBJECTID,JURSCODE,COUNTY,COUNTYNAME,VTD,LABEL,NAME",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
        },
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    return data.get("features", [])


def fetch_all_features() -> list[dict]:
    object_ids = fetch_object_ids()
    if not object_ids:
        return []

    object_ids = sorted(object_ids)
    log.info(f"Found {len(object_ids)} precinct object IDs")

    all_features: list[dict] = []

    for index in range(0, len(object_ids), OBJECT_ID_BATCH_SIZE):
        batch_ids = object_ids[index:index + OBJECT_ID_BATCH_SIZE]
        features = fetch_feature_batch(batch_ids)
        all_features.extend(features)
        log.info(
            f"  Fetched {len(features)} features in batch "
            f"({len(all_features)} total)"
        )
        time.sleep(REQUEST_DELAY_SECONDS)

    return all_features


# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------

def normalize_county_fips(raw: object) -> str:
    if raw is None:
        return ""

    text = str(raw).strip()
    if not text:
        return ""

    if "." in text:
        text = text.split(".", 1)[0]

    if len(text) == 5 and text.startswith("24"):
        return text[-3:]

    return text.zfill(3)


def build_precinct_code(properties: dict) -> Optional[str]:
    vtd = str(properties.get("VTD") or "").strip()
    if vtd:
        return vtd

    county = str(properties.get("COUNTY") or "").strip()
    label = str(properties.get("LABEL") or "").strip()
    name = str(properties.get("NAME") or "").strip()

    fallback = label or name
    if county and fallback:
        normalized = "-".join(fallback.lower().split())
        return f"{county}-{normalized}"

    return None


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def load_boundaries() -> dict:
    supabase = get_client()

    result = supabase.table("jurisdictions").select("id, slug").execute()
    jurisdiction_map: dict[str, str] = {row["slug"]: row["id"] for row in result.data}
    jurisdiction_id_to_slug = {row["id"]: row["slug"] for row in result.data}
    log.info(f"Loaded {len(jurisdiction_map)} jurisdictions from database")

    if not jurisdiction_map:
        raise RuntimeError("No jurisdictions found. Run seed_jurisdictions.sql first.")

    log.info(f"Fetching precinct boundaries from Maryland iMAP: {PRECINCT_LAYER_URL}")
    features = fetch_all_features()
    if not features:
        raise RuntimeError("No precinct features returned from Maryland iMAP.")

    inserted = 0
    skipped = 0
    errors = 0
    unknown_fips = set()

    for feature in features:
        properties = feature.get("properties", {})
        geometry = feature.get("geometry")

        if not geometry:
            skipped += 1
            continue

        county_fips = normalize_county_fips(properties.get("COUNTY"))
        jurisdiction_slug = COUNTY_FIPS_TO_SLUG.get(county_fips)
        if not jurisdiction_slug:
            unknown_fips.add(county_fips)
            skipped += 1
            continue

        jurisdiction_id = jurisdiction_map.get(jurisdiction_slug)
        if not jurisdiction_id:
            skipped += 1
            continue

        precinct_code = build_precinct_code(properties)
        if not precinct_code:
            skipped += 1
            continue

        try:
            supabase.rpc(
                "upsert_precinct",
                {
                    "p_precinct_code": precinct_code,
                    "p_jurisdiction_id": jurisdiction_id,
                    "p_geometry_geojson": json.dumps(geometry),
                    "p_source_url": PRECINCT_LAYER_URL,
                },
            ).execute()
            inserted += 1

            if inserted % 100 == 0:
                log.info(f"  Upserted {inserted} precincts...")
        except Exception as exc:
            log.error(f"DB error for precinct {precinct_code}: {exc}")
            errors += 1

    if unknown_fips:
        log.warning(f"Unknown county FIPS values encountered: {sorted(unknown_fips)}")

    log.info(f"Precinct load complete: {inserted} inserted, {skipped} skipped, {errors} errors")

    log.info("Building precinct_contests mapping for county-wide races...")
    mapped = _map_county_wide_contests(supabase)
    log.info(f"Mapped {mapped} precinct-contest pairs")

    if VALIDATION_SAMPLES:
        log.info("Validating boundary lookups...")
        _validate_boundaries(supabase, jurisdiction_id_to_slug)

    return {
        "features_fetched": len(features),
        "precincts_inserted": inserted,
        "precincts_skipped": skipped,
        "errors": errors,
        "county_wide_mapped": mapped,
    }


def _map_county_wide_contests(supabase) -> int:
    contests = (
        supabase.table("contests")
        .select("id, jurisdiction_id, district_name")
        .is_("district_name", "null")
        .execute()
    ).data

    log.info(f"  Found {len(contests)} county-wide contests")
    total = 0

    for contest in contests:
        precincts = (
            supabase.table("precincts")
            .select("id")
            .eq("jurisdiction_id", contest["jurisdiction_id"])
            .execute()
        ).data

        if not precincts:
            continue

        rows = [{"precinct_id": row["id"], "contest_id": contest["id"]} for row in precincts]

        for index in range(0, len(rows), 500):
            batch = rows[index:index + 500]
            supabase.table("precinct_contests").upsert(
                batch, on_conflict="precinct_id,contest_id"
            ).execute()
            total += len(batch)

    return total


def _validate_boundaries(supabase, jurisdiction_id_to_slug: dict[str, str]) -> None:
    passed = 0
    failed = 0

    for lat, lng, expected_slug, description in VALIDATION_SAMPLES:
        try:
            result = supabase.rpc("lookup_precinct", {"p_lat": lat, "p_lng": lng}).execute()

            if not result.data:
                log.warning(f"  FAIL: {description} — no precinct found at ({lat}, {lng})")
                failed += 1
                continue

            row = result.data[0]
            actual_slug = jurisdiction_id_to_slug.get(row["jurisdiction_id"])
            if actual_slug == expected_slug:
                log.info(f"  PASS: {description} → {row['precinct_code']}")
                passed += 1
            else:
                log.warning(
                    f"  FAIL: {description} expected={expected_slug} got={actual_slug}"
                )
                failed += 1
        except Exception as exc:
            log.error(f"  ERROR validating {description}: {exc}")
            failed += 1

    log.info(f"Validation: {passed} passed, {failed} failed")


if __name__ == "__main__":
    log.info("=== load_precinct_boundaries.py ===")
    log.info(f"Source: {PRECINCT_LAYER_URL}")

    try:
        summary = load_boundaries()
        log.info(f"Done. Summary: {summary}")
        sys.exit(0)
    except Exception as exc:
        log.error(f"Fatal error: {exc}")
        raise
