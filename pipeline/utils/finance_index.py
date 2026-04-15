"""
finance_index.py

Loads the Maryland Campaign Finance committee CSV into an in-memory lookup index.
Called once at pipeline startup; result is cached in module scope.

Source file:
  campaignfinance.maryland.gov/public/cf/downloads → "Committee" download
  Place the CSV at docs/finance/Committee Download*.csv  (any filename matching that glob)
  Or override the path with COMMITTEE_CSV_PATH in .env.

Usage:
  from pipeline.utils.finance_index import lookup, load_index

  record = lookup("Jane Smith", "Howard County")
  if record:
      print(record.committee_name, record.facebook_url)
"""

from __future__ import annotations

import csv
import glob
import logging
import os
import re
from dataclasses import dataclass
from typing import Optional

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class CommitteeRecord:
    committee_name: str
    treasurer_name: Optional[str]
    address: Optional[str]
    candidate_email: Optional[str]
    candidate_phone: Optional[str]
    facebook_url: Optional[str]
    instagram_url: Optional[str]
    twitter_handle: Optional[str]
    linkedin_url: Optional[str]
    website_url: Optional[str]
    jurisdiction: Optional[str]    # short form as in CSV — no "County" suffix
    office_sought: Optional[str]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clean_url(value: str) -> Optional[str]:
    """Add https:// if scheme missing; return None if empty."""
    v = value.strip()
    if not v:
        return None
    if not re.match(r'^https?://', v, re.IGNORECASE):
        v = "https://" + v
    return v


def _clean_twitter(value: str) -> Optional[str]:
    """Return bare handle (no @, no URL prefix) or None."""
    v = value.strip()
    if not v:
        return None
    # Strip full URL if someone pasted it
    v = re.sub(r'https?://(www\.)?(twitter\.com|x\.com)/@?', '', v, flags=re.IGNORECASE)
    return v.lstrip("@").strip() or None


def _normalize(s: str) -> str:
    return s.strip().lower()


def _find_committee_csv() -> Optional[str]:
    """
    Locate the committee CSV.
    Priority: COMMITTEE_CSV_PATH env var → docs/finance/Committee Download*.csv
    Returns the most recently modified match, or None.
    """
    env_path = os.environ.get("COMMITTEE_CSV_PATH", "").strip()
    if env_path and os.path.isfile(env_path):
        return env_path

    # Walk up from pipeline/utils/ to project root and search docs/finance/
    here = os.path.dirname(__file__)
    project_root = os.path.abspath(os.path.join(here, "..", ".."))
    pattern = os.path.join(project_root, "docs", "finance", "Committee Download*.csv")
    matches = glob.glob(pattern)
    if matches:
        return max(matches, key=os.path.getmtime)

    return None


# ---------------------------------------------------------------------------
# Index loading and caching
# ---------------------------------------------------------------------------

# Module-level cache: (lastname_lower, firstname_lower) → list[CommitteeRecord]
_index: Optional[dict[tuple[str, str], list[CommitteeRecord]]] = None


def load_index() -> dict[tuple[str, str], list[CommitteeRecord]]:
    """
    Load the committee CSV and return the lookup index.
    Subsequent calls return the cached result — safe to call per-candidate.
    """
    global _index
    if _index is not None:
        return _index

    csv_path = _find_committee_csv()
    if not csv_path:
        log.warning(
            "Committee CSV not found — Phase 1 finance lookup will be skipped. "
            "Download the file from campaignfinance.maryland.gov/public/cf/downloads "
            "and place it at docs/finance/Committee Download*.csv, "
            "or set COMMITTEE_CSV_PATH in .env."
        )
        _index = {}
        return _index

    log.info(f"Loading committee index from: {os.path.basename(csv_path)}")
    index: dict[tuple[str, str], list[CommitteeRecord]] = {}
    count = 0

    with open(csv_path, newline="", encoding="utf-8-sig", errors="replace") as f:
        next(f)  # skip "Committee Download as of..." title row
        reader = csv.DictReader(f)
        for row in reader:
            last = _normalize(row.get("Candidate LastName", ""))
            first = _normalize(row.get("Candidate First Name", ""))
            if not last:
                continue  # PAC, party committee, or non-candidate entity

            record = CommitteeRecord(
                committee_name=row.get("Committee Name", "").strip(),
                treasurer_name=row.get("Treasurer/Authorized Agent Name", "").strip() or None,
                address=" ".join(
                    p for p in [
                        row.get("Committee Mailing Address1", "").strip(),
                        row.get("Committee City", "").strip(),
                        row.get("Committee State", "").strip(),
                    ]
                    if p
                ) or None,
                candidate_email=row.get("Candidate Email", "").strip() or None,
                candidate_phone=row.get("Candidate Public Phone", "").strip() or None,
                facebook_url=_clean_url(row.get("Facebook", "")),
                instagram_url=_clean_url(row.get("Instagram", "")),
                twitter_handle=_clean_twitter(row.get("X (Twitter)", "")),
                linkedin_url=_clean_url(row.get("LinkedIn", "")),
                website_url=_clean_url(row.get("Website", "")),
                jurisdiction=row.get("Jurisdiction", "").strip() or None,
                office_sought=row.get("Office Sought", "").strip() or None,
            )

            key = (last, first)
            index.setdefault(key, []).append(record)
            count += 1

    log.info(f"Committee index ready: {count} records, {len(index)} unique name keys")
    _index = index
    return _index


# ---------------------------------------------------------------------------
# Public lookup
# ---------------------------------------------------------------------------

def lookup(full_name: str, jurisdiction: str) -> Optional[CommitteeRecord]:
    """
    Look up a candidate by full name and jurisdiction.

    Matching strategy:
      1. Split full_name into first/last; exact (last, first) key lookup.
      2. Multiple name matches → pick the one whose jurisdiction matches.
      3. Still ambiguous → log a warning and return the first match.
      4. No match → return None.

    Jurisdiction normalisation: strips " County" / " City" because the CSV
    uses short forms ("Howard", "Baltimore City") while the DB uses full forms
    ("Howard County", "Baltimore City").
    """
    index = load_index()
    if not index:
        return None

    parts = full_name.strip().split()
    if len(parts) < 2:
        return None

    first = _normalize(parts[0])
    last = _normalize(parts[-1])
    candidates = index.get((last, first), [])

    if not candidates:
        return None

    if len(candidates) == 1:
        return candidates[0]

    # Disambiguate by jurisdiction — CSV short form vs DB full form
    jur_short = (
        jurisdiction.lower()
        .replace(" county", "")
        .replace(" city", "")
        .strip()
    )
    for rec in candidates:
        if rec.jurisdiction and rec.jurisdiction.lower() == jur_short:
            return rec

    log.warning(
        f"Ambiguous committee match for '{full_name}' in '{jurisdiction}': "
        f"{len(candidates)} records, no jurisdiction match. Using first."
    )
    return candidates[0]
