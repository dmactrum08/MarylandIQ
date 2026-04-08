"""
ingest_sbe_candidates.py

Stage 2 script — ingests 2026 Maryland local candidates from the official
Maryland SBE candidate listing page into the candidates table.

SOURCE:
    https://elections.maryland.gov/elections/2026/Primary_candidates/2026_GP_all_counties_candidatelist.html

NOTES:
    - The current live SBE page is heading-based HTML, not a simple table.
    - The page exposes official candidate information, but not a clear public
      numeric candidate ID in the HTML. Until a stable official ID field is
      confirmed in the downloadable CSV, we generate a deterministic ID from
      official page data so repeated runs remain idempotent.
"""

import hashlib
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

    # Plain-text fallback (e.g. Website field with a bare URL string)
    if label == "Website":
        text = dd.get_text(" ", strip=True)
        if text.startswith(("http://", "https://")):
            return text
        if text.startswith("www."):
            return f"https://{text}"

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
            filing_status = str(details.get("status") or "Active")
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


def upsert_candidates(supabase, records: list[CandidateRecord]) -> dict[str, int]:
    contest_lookup = build_contest_lookup(supabase)

    existing_rows = supabase.table("candidates").select(
        "id, contest_id, full_name, sbe_candidate_id, filing_status, party, campaign_website_url, facebook_url, linkedin_url, twitter_handle"
    ).execute().data
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
            supabase.table("candidates").insert(row).execute()
            existing_by_sbe_id[record.sbe_candidate_id] = row
            existing_by_contest_and_name[(contest_id, record.full_name.strip().lower())] = row
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


def ingest_sbe_candidates() -> dict[str, int]:
    supabase = get_client()
    soup = fetch_candidate_page()
    time.sleep(REQUEST_DELAY)

    records = parse_candidate_records(soup)
    log.info(f"Parsed {len(records)} candidate records from SBE page")

    if os.environ.get("MARYLANDIQ_DEBUG_CANDIDATES") == "1":
        for record in records[:DEBUG_SAMPLE_LIMIT]:
            log.info(
                "DEBUG candidate: jurisdiction=%s office=%s district=%s name=%s party=%s",
                record.jurisdiction_slug,
                record.office_name,
                record.district_name,
                record.full_name,
                record.party,
            )

    summary = upsert_candidates(supabase, records)
    log_pipeline_run(supabase, summary)
    return summary


if __name__ == "__main__":
    log.info("=== ingest_sbe_candidates.py ===")
    log.info(f"Source: {SBE_LOCAL_CANDIDATES_URL}")

    try:
        summary = ingest_sbe_candidates()
        log.info(f"Done. Summary: {summary}")
        sys.exit(0)
    except Exception as exc:
        log.error(f"Fatal error: {exc}")
        raise
