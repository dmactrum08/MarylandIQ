"""
ingest_sbe_candidates.py

Stage 2 script — ingests 2026 Maryland candidates into the candidates table.

Sources:
  - County/local candidates (HTML):
    elections.maryland.gov/.../2026_GP_all_counties_candidatelist.html
  - Statewide offices (CSV — Governor, AG, Comptroller):
    elections.maryland.gov/.../2026_GP_statewide_candidatelist.csv
  - State Senate (CSV):
    elections.maryland.gov/.../2026_GP_statesenatorbydistrict_candidatelist.csv
  - House of Delegates (CSV):
    elections.maryland.gov/.../2026_GP_houseofdelegatesbydistrict_candidatelist.csv
  - U.S. House (CSV):
    elections.maryland.gov/.../2026_GP_representativeincongressbydistrict_candidatelist.csv

Prerequisites:
  - database/004_state_federal.sql must be run first (adds maryland-statewide
    jurisdiction and state/federal office records)
"""

import csv
import hashlib
import io
import logging
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import requests
from bs4 import BeautifulSoup, Tag

from pipeline.utils.supabase_client import get_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

SBE_LOCAL_CANDIDATES_URL = (
    "https://elections.maryland.gov/elections/2026/Primary_candidates/"
    "2026_GP_all_counties_candidatelist.html"
)

SBE_CSV_SOURCES = {
    "statewide": (
        "https://elections.maryland.gov/elections/2026/Primary_candidates/"
        "2026_GP_statewide_candidatelist.csv"
    ),
    "state_senate": (
        "https://elections.maryland.gov/elections/2026/Primary_candidates/"
        "2026_GP_statesenatorbydistrict_candidatelist.csv"
    ),
    "house_of_delegates": (
        "https://elections.maryland.gov/elections/2026/Primary_candidates/"
        "2026_GP_houseofdelegatesbydistrict_candidatelist.csv"
    ),
    "us_house": (
        "https://elections.maryland.gov/elections/2026/primary_candidates/"
        "2026_GP_representativeincongressbydistrict_candidatelist.csv"
    ),
}

# Maps SBE CSV "Office Name" values → normalized names used in the offices table
CSV_OFFICE_NAME_MAP = {
    "governor / lt. governor": "Governor",
    "governor": "Governor",
    "attorney general": "Attorney General",
    "comptroller": "Comptroller",
    "state senator": "State Senator",
    "house of delegates": "House of Delegates Member",
    "representative in congress": "U.S. Representative",
    "united states senator": "U.S. Senator",
}

# Slugs must match what database/004_state_federal.sql inserts
CSV_OFFICE_SLUG_MAP = {
    "Governor": "governor",
    "Attorney General": "attorney-general",
    "Comptroller": "comptroller",
    "State Senator": "state-senator",
    "House of Delegates Member": "house-of-delegates-member",
    "U.S. Representative": "us-representative",
    "U.S. Senator": "us-senator",
}

REQUEST_TIMEOUT = 20
REQUEST_DELAY = 1.0
ELECTION_TYPE = "primary"
ELECTION_YEAR = "2026"
DEBUG_SAMPLE_LIMIT = 10

JURISDICTION_NAME_TO_SLUG = {
    "Allegany County": "allegany-county",
    "Anne Arundel County": "anne-arundel-county",
    "Baltimore City": "baltimore-city",
    "Baltimore County": "baltimore-county",
    "Calvert County": "calvert-county",
    "Caroline County": "caroline-county",
    "Carroll County": "carroll-county",
    "Cecil County": "cecil-county",
    "Charles County": "charles-county",
    "Dorchester County": "dorchester-county",
    "Frederick County": "frederick-county",
    "Garrett County": "garrett-county",
    "Harford County": "harford-county",
    "Howard County": "howard-county",
    "Kent County": "kent-county",
    "Montgomery County": "montgomery-county",
    "Prince George's County": "prince-georges-county",
    "Queen Anne's County": "queen-annes-county",
    "Saint Mary's County": "saint-marys-county",
    "Somerset County": "somerset-county",
    "Talbot County": "talbot-county",
    "Washington County": "washington-county",
    "Wicomico County": "wicomico-county",
    "Worcester County": "worcester-county",
}


@dataclass
class CandidateRecord:
    jurisdiction_slug: str
    office_name: str
    district_name: Optional[str]
    full_name: str
    party: Optional[str]
    filing_status: str
    filed_date: Optional[str]
    campaign_website_url: Optional[str]
    facebook_url: Optional[str]
    linkedin_url: Optional[str]
    twitter_handle: Optional[str]
    sbe_candidate_id: str


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"['\u2019]", "", text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def normalize_office_name(text: str) -> str:
    cleaned = " ".join(text.split())
    mapping = {
        "County Council": "County Council Member",
        "County Council At Large": "County Council Member (At-Large)",
        "Board of Education": "Board of Education Member",
        "Judge of the Orphans' Court": "Orphans' Court Judge",
        "County Commissioner": "County Commissioner",
    }
    return mapping.get(cleaned, cleaned)


def normalize_district_name(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    raw = " ".join(text.split()).strip()
    if not raw:
        return None

    lower = raw.lower()
    if "at large" in lower:
        return None

    match = re.search(r"(district|commissioner district)\s+([a-z0-9-]+)$", raw, re.IGNORECASE)
    if match:
        return f"District {match.group(2).upper()}"

    return raw


def normalize_party(text: Optional[str]) -> Optional[str]:
    if not text:
        return None

    cleaned = " ".join(str(text).split()).strip()
    if not cleaned:
        return None

    normalized = cleaned.lower()
    party_map = {
        "democratic": "Democratic",
        "democrat": "Democratic",
        "dem": "Democratic",
        "republican": "Republican",
        "rep": "Republican",
        "green": "Green",
        "libertarian": "Libertarian",
        "unaffiliated": "Unaffiliated",
        "no party affiliation": "Unaffiliated",
        "non-partisan": "Nonpartisan",
        "nonpartisan": "Nonpartisan",
    }

    return party_map.get(normalized)


def normalize_filing_status(text: Optional[str]) -> str:
    """
    Map SBE status labels into the coarse statuses allowed by candidates.filing_status.
    """
    if not text:
        return "Active"

    cleaned = " ".join(str(text).split()).strip()
    if not cleaned:
        return "Active"

    normalized = cleaned.lower()

    if "withdraw" in normalized:
        return "Withdrawn"

    if any(token in normalized for token in ("disqual", "ineligible", "removed", "stricken")):
        return "Disqualified"

    # SBE uses more specific active-style labels such as "Seeking the Nomination".
    return "Active"


def parse_filed_date(text: str) -> Optional[str]:
    match = re.search(r"(\d{2}/\d{2}/\d{4})", text)
    if not match:
        return None
    return datetime.strptime(match.group(1), "%m/%d/%Y").date().isoformat()


def classify_social(text: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    facebook_url = None
    linkedin_url = None
    twitter_handle = None

    lower = text.lower().strip()
    if not lower:
        return facebook_url, linkedin_url, twitter_handle

    if "facebook.com/" in lower:
        facebook_url = text.strip()
    elif "linkedin.com/" in lower:
        linkedin_url = text.strip()
    elif lower.startswith("@"):
        twitter_handle = text.strip()
    elif "x.com/" in lower or "twitter.com/" in lower:
        twitter_handle = text.strip()

    return facebook_url, linkedin_url, twitter_handle


def make_candidate_key(
    jurisdiction_slug: str,
    office_name: str,
    district_name: Optional[str],
    full_name: str,
) -> str:
    base = "|".join(
        [
            ELECTION_YEAR,
            ELECTION_TYPE,
            jurisdiction_slug,
            office_name,
            district_name or "",
            full_name,
        ]
    )
    digest = hashlib.sha256(base.encode("utf-8")).hexdigest()[:24]
    return f"md-sbe-{digest}"


def make_candidate_slug(record: CandidateRecord) -> str:
    parts = [
        slugify(record.full_name),
        record.jurisdiction_slug,
        slugify(record.office_name),
    ]
    if record.district_name:
        parts.append(slugify(record.district_name))
    parts.extend([ELECTION_YEAR, ELECTION_TYPE])
    return "-".join(parts)


def fetch_candidate_page() -> BeautifulSoup:
    response = requests.get(
        SBE_LOCAL_CANDIDATES_URL,
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": "MarylandIQ/1.0 (voter information platform)"},
    )
    response.raise_for_status()
    return BeautifulSoup(response.text, "html.parser")


def _decode_cf_protected(encoded: str) -> Optional[str]:
    """
    Decode a Cloudflare email-protection encoded string.
    The SBE page runs behind Cloudflare, which obfuscates <a> hrefs containing
    '@' characters. The algorithm is a simple XOR with the first byte as key.
    If the decoded value looks like a URL (starts with http/www) we return it;
    otherwise it is an email address and we return None.
    """
    try:
        key = int(encoded[:2], 16)
        decoded = "".join(
            chr(int(encoded[i: i + 2], 16) ^ key) for i in range(2, len(encoded), 2)
        )
        # Reject anything containing '@' — it's an email, not a URL
        if "@" in decoded:
            return None
        if decoded.startswith(("http://", "https://")):
            return decoded
        if decoded.startswith("www."):
            return f"https://{decoded}"
        return None  # it's an email address — skip
    except Exception:
        return None


def _extract_dd_value(dd: Tag, label: str) -> Optional[str]:
    """
    Pull a meaningful string value out of a <dd> element.

    Handles three cases:
      1. Plain <a href="https://..."> — return the href directly.
      2. Cloudflare-protected <a data-cfemail="..."> — decode and return if URL.
      3. Social platform <div class="facebook|twitter|..."> — return text as URL.
    """
    # Case 1 + 2: any <a> tag inside the <dd>
    for a_tag in dd.find_all("a"):
        href = a_tag.get("href", "")

        # Cloudflare inline protection: data-cfemail on the <a> itself
        data_cf = a_tag.get("data-cfemail", "")
        if data_cf:
            return _decode_cf_protected(data_cf)

        # Cloudflare href protection: href="/cdn-cgi/l/email-protection#HEXSTRING"
        if href.startswith("/cdn-cgi/l/email-protection#"):
            encoded = href.split("#", 1)[1]
            return _decode_cf_protected(encoded)

        # Skip mailto and bare Cloudflare catch-all href
        if href.startswith("mailto:") or href == "/cdn-cgi/l/email-protection":
            return None

        # Regular URL
        if href.startswith(("http://", "https://")):
            return href

    # Case 3: social platform divs — text contains the URL without scheme
    if label == "Social":
        for div in dd.find_all("div"):
            text = div.get_text(strip=True)
            if not text:
                continue
            if text.startswith(("http://", "https://")):
                return text
            # Add scheme based on platform hints
            lower = text.lower()
            if any(p in lower for p in ("facebook.com", "twitter.com", "x.com",
                                         "instagram.com", "linkedin.com")):
                prefix = "www." if not text.startswith("www.") else ""
                return f"https://{prefix}{text}"
            return f"https://{text}"

    # Plain-text fallback for labels whose values are never links
    if label in ("Status", "Filed", "Website"):
        text = dd.get_text(" ", strip=True)
        if not text:
            return None
        if label == "Website":
            if text.startswith(("http://", "https://")):
                return text
            if text.startswith("www."):
                return f"https://{text}"
            return None
        return text  # Status / Filed are always plain text

    return None


def extract_candidate_details(start_heading: Tag) -> dict[str, object]:
    """
    Extract structured candidate detail fields from the siblings that follow
    a candidate name heading (<h4> or <h5>).

    Page structure (confirmed April 2026):
        <h4>Candidate Name</h4>
        <span>Democratic</span>          ← party
        <div class="candidate">
          <dl class="columns shaded">
            <dt>Jurisdiction</dt><dd>...</dd>
            <dt>Status</dt><dd>Active</dd>
            <dt>Filed</dt><dd>Regular - 02/20/2026</dd>
            <dt>Website</dt><dd><a href="..."> or plain text</dd>
            <dt>Social</dt><dd><div class="facebook">facebook.com/...</div></dd>
            ...
          </dl>
        </div>
    """
    details: dict[str, object] = {"social_links": []}

    for node in start_heading.next_siblings:
        if not isinstance(node, Tag):
            continue

        # Stop at the next candidate/section heading
        if node.name in {"h2", "h3", "h4", "h5"}:
            break

        # Party lives in a bare <span> between the heading and the candidate div
        if node.name == "span" and "party" not in details:
            party_text = node.get_text(strip=True)
            normalized = normalize_party(party_text)
            if normalized:
                details["party"] = normalized
            continue

        # All structured data is inside <div class="candidate">
        if node.name == "div" and "candidate" in (node.get("class") or []):
            dl = node.find("dl")
            if not dl:
                break

            current_label: Optional[str] = None
            for child in dl.children:
                if not isinstance(child, Tag):
                    continue
                if child.name == "dt":
                    current_label = child.get_text(strip=True)
                elif child.name == "dd" and current_label:
                    value = _extract_dd_value(child, current_label)
                    if current_label == "Status" and value:
                        details["status"] = value
                    elif current_label == "Filed" and value:
                        details["filed"] = value
                    elif current_label == "Website" and value:
                        details["website"] = value
                    elif current_label == "Social" and value:
                        details["social_links"].append(value)
            break

    return details


def parse_candidate_records(soup: BeautifulSoup) -> list[CandidateRecord]:
    records: list[CandidateRecord] = []
    current_jurisdiction_slug: Optional[str] = None
    current_office_name: Optional[str] = None
    current_district_name: Optional[str] = None

    for heading in soup.find_all(["h2", "h3", "h4", "h5"]):
        text = heading.get_text(" ", strip=True)
        if not text:
            continue

        if heading.name == "h2" and text in JURISDICTION_NAME_TO_SLUG:
            current_jurisdiction_slug = JURISDICTION_NAME_TO_SLUG[text]
            current_office_name = None
            current_district_name = None
            continue

        if not current_jurisdiction_slug:
            continue

        if heading.name == "h3":
            current_office_name = normalize_office_name(text)
            current_district_name = None
            continue

        if heading.name in {"h4", "h5"} and current_office_name:
            normalized_candidate_district = normalize_district_name(text)
            lower = text.lower()

            is_district_heading = (
                "district" in lower and
                not lower.startswith("judge") and
                heading.name == "h4"
            )

            if is_district_heading:
                current_district_name = normalized_candidate_district
                if "at large" in lower and current_office_name == "County Council Member":
                    current_office_name = "County Council Member (At-Large)"
                    current_district_name = None
                continue

            if heading.name == "h4" and current_district_name is None:
                candidate_name = text
            elif heading.name == "h5":
                candidate_name = text
            else:
                continue

            details = extract_candidate_details(heading)
            filing_status = normalize_filing_status(details.get("status"))
            party = normalize_party(details.get("party"))

            website = details.get("website")
            if isinstance(website, str):
                website = website.strip()

            facebook_url = None
            linkedin_url = None
            twitter_handle = None
            for social in details.get("social_links", []):
                fb, li, tw = classify_social(str(social))
                facebook_url = facebook_url or fb
                linkedin_url = linkedin_url or li
                twitter_handle = twitter_handle or tw

            district_name = current_district_name
            office_name = current_office_name

            record = CandidateRecord(
                jurisdiction_slug=current_jurisdiction_slug,
                office_name=office_name,
                district_name=district_name,
                full_name=candidate_name,
                party=party or None,
                filing_status=filing_status,
                filed_date=parse_filed_date(str(details.get("filed") or "")),
                campaign_website_url=website or None,
                facebook_url=facebook_url,
                linkedin_url=linkedin_url,
                twitter_handle=twitter_handle,
                sbe_candidate_id=make_candidate_key(
                    current_jurisdiction_slug,
                    office_name,
                    district_name,
                    candidate_name,
                ),
            )
            records.append(record)

    return records


def build_contest_lookup(supabase) -> dict[tuple[str, str, str], str]:
    jurisdictions = supabase.table("jurisdictions").select("id, slug").execute().data
    jurisdiction_id_to_slug = {row["id"]: row["slug"] for row in jurisdictions}

    offices = supabase.table("offices").select("id, name").execute().data
    office_id_to_name = {row["id"]: row["name"] for row in offices}

    contests = supabase.table("contests").select(
        "id, jurisdiction_id, office_id, district_name, election_type"
    ).execute().data

    lookup: dict[tuple[str, str, str], str] = {}
    for contest in contests:
        jurisdiction_slug = jurisdiction_id_to_slug.get(contest["jurisdiction_id"])
        office_name = office_id_to_name.get(contest["office_id"])
        if not jurisdiction_slug or not office_name:
            continue

        district_name = contest.get("district_name") or ""
        key = (jurisdiction_slug, office_name, district_name)
        lookup[key] = contest["id"]

    return lookup


def find_contest_id(contest_lookup: dict[tuple[str, str, str], str], record: CandidateRecord) -> Optional[str]:
    district_key = record.district_name or ""
    return contest_lookup.get((record.jurisdiction_slug, record.office_name, district_key))


def _fetch_all_candidates(supabase, columns: str) -> list[dict]:
    """Paginated fetch of all candidates rows to avoid the 1000-row default limit."""
    PAGE = 1000
    all_rows: list[dict] = []
    offset = 0
    while True:
        batch = (
            supabase.table("candidates")
            .select(columns)
            .range(offset, offset + PAGE - 1)
            .execute()
            .data
        )
        all_rows.extend(batch)
        if len(batch) < PAGE:
            break
        offset += PAGE
    return all_rows


def update_filing_statuses(supabase, records: list[CandidateRecord]) -> dict[str, int]:
    """
    Sync only filing_status from a freshly-parsed SBE list.
    Never inserts, never touches social/website fields.
    """
    existing_rows = _fetch_all_candidates(
        supabase, "id, sbe_candidate_id, full_name, filing_status"
    )
    by_sbe_id = {r["sbe_candidate_id"]: r for r in existing_rows if r.get("sbe_candidate_id")}

    updated = 0
    withdrawals = 0

    for record in records:
        existing = by_sbe_id.get(record.sbe_candidate_id)
        if not existing:
            continue
        if existing["filing_status"] == record.filing_status:
            continue

        payload: dict = {"filing_status": record.filing_status}
        if record.filing_status == "Withdrawn":
            payload["withdrawn_detected_at"] = datetime.utcnow().isoformat()
            withdrawals += 1
            log.info(
                "Withdrawn: %s (%s → %s)",
                existing["full_name"],
                existing["filing_status"],
                record.filing_status,
            )
        else:
            log.info(
                "Status change: %s (%s → %s)",
                existing["full_name"],
                existing["filing_status"],
                record.filing_status,
            )

        supabase.table("candidates").update(payload).eq("id", existing["id"]).execute()
        updated += 1

    log.info("update_filing_statuses: %d updated (%d withdrawals)", updated, withdrawals)
    return {"candidates_processed": updated, "new_detected": 0,
            "withdrawals_detected": withdrawals, "errors": 0}


def upsert_candidates(supabase, records: list[CandidateRecord]) -> dict[str, int]:
    contest_lookup = build_contest_lookup(supabase)

    existing_rows = _fetch_all_candidates(
        supabase,
        "id, contest_id, full_name, sbe_candidate_id, filing_status, party, campaign_website_url, facebook_url, linkedin_url, twitter_handle",
    )
    existing_by_sbe_id = {row["sbe_candidate_id"]: row for row in existing_rows}
    existing_by_contest_and_name = {
        (row["contest_id"], row["full_name"].strip().lower()): row for row in existing_rows
    }

    candidates_processed = 0
    new_detected = 0
    withdrawals_detected = 0
    errors = 0

    for record in records:
        contest_id = find_contest_id(contest_lookup, record)
        if not contest_id:
            continue

        row = {
            "slug": make_candidate_slug(record),
            "contest_id": contest_id,
            "full_name": record.full_name,
            "party": record.party,
            "filing_status": record.filing_status,
            "filed_date": record.filed_date,
            "sbe_candidate_id": record.sbe_candidate_id,
            "campaign_website_url": record.campaign_website_url,
            "facebook_url": record.facebook_url,
            "linkedin_url": record.linkedin_url,
            "twitter_handle": record.twitter_handle,
        }

        existing = existing_by_sbe_id.get(record.sbe_candidate_id)
        if existing is None:
            existing = existing_by_contest_and_name.get((contest_id, record.full_name.strip().lower()))
        if existing is None:
            insert_response = supabase.table("candidates").insert(row).execute()
            inserted = (insert_response.data or [{}])[0]
            cached_row = {
                "id": inserted.get("id"),
                **row,
            }
            existing_by_sbe_id[record.sbe_candidate_id] = cached_row
            existing_by_contest_and_name[(contest_id, record.full_name.strip().lower())] = cached_row
            new_detected += 1
            candidates_processed += 1
            continue

        changed = False
        if existing.get("filing_status") != record.filing_status:
            changed = True
            if record.filing_status == "Withdrawn":
                row["withdrawn_detected_at"] = datetime.utcnow().isoformat()
                withdrawals_detected += 1

        if existing.get("party") != row.get("party"):
            changed = True

        for field in ["campaign_website_url", "facebook_url", "linkedin_url", "twitter_handle"]:
            if existing.get(field) != row.get(field):
                changed = True
                break

        if changed:
            supabase.table("candidates").update(row).eq(
                "id", existing["id"]
            ).execute()
            refreshed = {
                **existing,
                **row,
            }
            existing_by_sbe_id[record.sbe_candidate_id] = refreshed
            existing_by_contest_and_name[(contest_id, record.full_name.strip().lower())] = refreshed
            candidates_processed += 1

    return {
        "candidates_processed": candidates_processed,
        "new_detected": new_detected,
        "withdrawals_detected": withdrawals_detected,
        "errors": errors,
    }


def log_pipeline_run(supabase, summary: dict[str, int]) -> None:
    supabase.table("pipeline_runs").insert(
        {
            "script_name": "ingest_sbe_candidates.py",
            "candidates_processed": summary["candidates_processed"],
            "new_detected": summary["new_detected"],
            "withdrawals_detected": summary["withdrawals_detected"],
            "errors": summary["errors"],
        }
    ).execute()


# ─── CSV helpers (state / federal sources) ───────────────────────────────────

def _normalize_url(raw: Optional[str]) -> Optional[str]:
    """Add https:// prefix if a URL is missing a scheme."""
    if not raw:
        return None
    raw = raw.strip()
    if not raw:
        return None
    if raw.startswith(("http://", "https://")):
        return raw
    if raw.startswith("www.") or "." in raw.split("/")[0]:
        return f"https://{raw}"
    return None


def fetch_csv(url: str) -> list[dict]:
    """Download a SBE CSV and return it as a list of row dicts."""
    resp = requests.get(
        url,
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": "MarylandIQ/1.0 (voter information platform)"},
    )
    resp.raise_for_status()
    # Strip UTF-8 BOM if present
    text = resp.content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    return [row for row in reader]


def parse_csv_candidates(rows: list[dict]) -> list[CandidateRecord]:
    """
    Convert raw SBE CSV rows into CandidateRecord objects.

    Key CSV columns used:
      - Office Name
      - Contest Run By District Name and Number  (e.g. "Legislative District 1A")
      - Candidate Ballot Last Name and Suffix
      - Candidate First Name and Middle Name
      - Office Political Party
      - Candidate Status
      - Filing Type and Date                     (e.g. "Regular - 02/24/2026")
      - Website / Facebook / X
    """
    records: list[CandidateRecord] = []

    for row in rows:
        raw_office = (row.get("Office Name") or "").strip()
        office_name = CSV_OFFICE_NAME_MAP.get(raw_office.lower())
        if not office_name:
            log.debug("CSV: skipping unknown office %r", raw_office)
            continue

        raw_district = (row.get("Contest Run By District Name and Number") or "").strip()
        # "State Of Maryland" means statewide — no district subdivision
        district_name: Optional[str] = None if raw_district.lower() in (
            "state of maryland", ""
        ) else raw_district

        last = (row.get("Candidate Ballot Last Name and Suffix") or "").strip().lstrip('"').rstrip('"')
        first = (row.get("Candidate First Name and Middle Name") or "").strip()
        if not last or not first:
            continue
        full_name = f"{first} {last}".strip()

        party = normalize_party(row.get("Office Political Party"))
        status_raw = (row.get("Candidate Status") or "Active").strip()
        filing_status = normalize_filing_status(status_raw)
        filed_date = parse_filed_date(row.get("Filing Type and Date") or "")

        website = _normalize_url(row.get("Website"))
        facebook_raw = row.get("Facebook") or ""
        facebook_url = None
        if facebook_raw.strip():
            fb, _, _ = classify_social(
                facebook_raw.strip() if "facebook.com" in facebook_raw.lower()
                else f"https://facebook.com/{facebook_raw.strip()}"
            )
            # If classify_social didn't catch it, try direct
            if not fb and "facebook.com" in facebook_raw.lower():
                fb = _normalize_url(facebook_raw.strip())
            facebook_url = fb

        twitter_raw = (row.get("X") or "").strip()
        twitter_handle = twitter_raw if twitter_raw else None

        records.append(
            CandidateRecord(
                jurisdiction_slug="maryland-statewide",
                office_name=office_name,
                district_name=district_name,
                full_name=full_name,
                party=party,
                filing_status=filing_status,
                filed_date=filed_date,
                campaign_website_url=website,
                facebook_url=facebook_url,
                linkedin_url=None,  # not in SBE CSV
                twitter_handle=twitter_handle,
                sbe_candidate_id=make_candidate_key(
                    "maryland-statewide",
                    office_name,
                    district_name,
                    full_name,
                ),
            )
        )

    return records


def ensure_state_federal_contests(supabase, records: list[CandidateRecord]) -> None:
    """
    Create any missing contests for state/federal candidates.
    Requires the maryland-statewide jurisdiction and relevant office records
    to already exist (run database/004_state_federal.sql first).
    """
    # Load the statewide jurisdiction ID
    result = supabase.table("jurisdictions").select("id").eq(
        "slug", "maryland-statewide"
    ).single().execute()
    if not result.data:
        log.error("maryland-statewide jurisdiction not found — run 004_state_federal.sql first")
        return
    jurisdiction_id = result.data["id"]

    # Load all office slugs → IDs
    office_rows = supabase.table("offices").select("id, slug").execute().data
    slug_to_office_id = {row["slug"]: row["id"] for row in office_rows}

    # Load existing contests for this jurisdiction to avoid duplicate inserts
    existing = supabase.table("contests").select(
        "office_id, district_name, election_type"
    ).eq("jurisdiction_id", jurisdiction_id).execute().data
    existing_keys = {
        (row["office_id"], row.get("district_name") or "", row["election_type"])
        for row in existing
    }

    seen: set[tuple] = set()
    for rec in records:
        office_slug = CSV_OFFICE_SLUG_MAP.get(rec.office_name)
        if not office_slug:
            continue
        office_id = slug_to_office_id.get(office_slug)
        if not office_id:
            log.warning("Office slug %r not found in DB — skipping", office_slug)
            continue

        key = (office_id, rec.district_name or "", ELECTION_TYPE)
        if key in existing_keys or key in seen:
            continue
        seen.add(key)

        # Build a slug for this contest
        parts = ["md"]
        parts.append(office_slug)
        if rec.district_name:
            parts.append(slugify(rec.district_name))
        parts.extend([ELECTION_YEAR, ELECTION_TYPE])
        contest_slug = "-".join(parts)

        supabase.table("contests").insert({
            "slug": contest_slug,
            "office_id": office_id,
            "jurisdiction_id": jurisdiction_id,
            "district_name": rec.district_name,
            "election_date": "2026-06-23",
            "election_type": ELECTION_TYPE,
            "seats_available": 1,
        }).execute()
        log.info("Created contest: %s", contest_slug)


def _fetch_sbe_records() -> list[CandidateRecord]:
    """Fetch and parse all SBE sources (HTML + CSVs). Returns combined list."""
    soup = fetch_candidate_page()
    time.sleep(REQUEST_DELAY)
    county_records = parse_candidate_records(soup)
    log.info("Parsed %d county candidate records from SBE HTML page", len(county_records))

    csv_records: list[CandidateRecord] = []
    for source_name, url in SBE_CSV_SOURCES.items():
        try:
            rows = fetch_csv(url)
            time.sleep(REQUEST_DELAY)
            parsed = parse_csv_candidates(rows)
            log.info("Parsed %d candidates from %s CSV", len(parsed), source_name)
            csv_records.extend(parsed)
        except Exception as exc:
            log.error("Failed to fetch/parse %s CSV (%s): %s", source_name, url, exc)

    return county_records + csv_records


def ingest_sbe_candidates(update_status_only: bool = False) -> dict[str, int]:
    supabase = get_client()

    all_records = _fetch_sbe_records()
    log.info("Total SBE records fetched: %d", len(all_records))

    if os.environ.get("MARYLANDIQ_DEBUG_CANDIDATES") == "1":
        for record in all_records[:DEBUG_SAMPLE_LIMIT]:
            log.info(
                "DEBUG candidate: jurisdiction=%s office=%s district=%s name=%s party=%s",
                record.jurisdiction_slug,
                record.office_name,
                record.district_name,
                record.full_name,
                record.party,
            )

    if update_status_only:
        summary = update_filing_statuses(supabase, all_records)
    else:
        csv_records = [r for r in all_records if r.jurisdiction_slug == "maryland-statewide"]
        if csv_records:
            ensure_state_federal_contests(supabase, csv_records)
        summary = upsert_candidates(supabase, all_records)

    log_pipeline_run(supabase, summary)
    return summary


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Ingest SBE candidate data.")
    parser.add_argument(
        "--update-status",
        action="store_true",
        help="Only sync filing_status for existing candidates — no inserts, no social/website changes.",
    )
    args = parser.parse_args()

    log.info("=== ingest_sbe_candidates.py ===")
    if args.update_status:
        log.info("Mode: update-status only (filing_status sync)")
    else:
        log.info("Sources: HTML (county) + 4 CSVs (state/federal)")

    try:
        summary = ingest_sbe_candidates(update_status_only=args.update_status)
        log.info(f"Done. Summary: {summary}")
        sys.exit(0)
    except Exception as exc:
        log.error(f"Fatal error: {exc}")
        raise
