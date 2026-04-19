"""
ingest_finance.py

Loads Maryland SBE campaign finance bulk exports into the candidate_finance table.

Sources
-------
  Committee Download         — one row per committee; maps candidate → filing_entity_id
  Contributions/Loan Download — all contribution transactions
  Expenditure Download       — all expenditure transactions

Matching strategy
-----------------
For each 2026 committee with a known office + jurisdiction:
  1. Map SBE office name → office slug
  2. Map SBE jurisdiction name → jurisdiction slug
  3. Load active candidates from DB for that office + jurisdiction
  4. Fuzzy-match SBE candidate name (Last + First) against DB full_name (threshold 0.82)
  5. Upsert candidate_finance row with aggregated totals

Flags
-----
  --dry-run   (default) Print matches without writing.
  --apply     Write to database.
  --threshold FLOAT   Fuzzy-match threshold (default 0.82).
  --finance-dir PATH  Directory containing the three SBE CSV files
                      (default: docs/Finance relative to repo root).

Usage
-----
  python -m pipeline.ingest_finance            # dry run
  python -m pipeline.ingest_finance --apply    # write to DB
"""

from __future__ import annotations

import argparse
import csv
import io
import logging
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path
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

# ---------------------------------------------------------------------------
# Repo-relative default path for the finance CSVs
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).parent.parent
DEFAULT_FINANCE_DIR = REPO_ROOT / "docs" / "Finance"

# ---------------------------------------------------------------------------
# Mapping tables: SBE names → DB slugs
# ---------------------------------------------------------------------------

OFFICE_SLUG_MAP: dict[str, str] = {
    "County Executive":              "county-executive",
    "County Council":                "county-council-member",
    "County Council - At-Large":     "county-council-at-large",
    "County Council - District":     "county-council-member",
    "County Commissioners":          "county-commissioner",
    "Board of Education":            "board-of-education",
    "Sheriff":                       "sheriff",
    "State's Attorney":              "states-attorney",
    "Register of Wills":             "register-of-wills",
    "Clerk of the Circuit Court":    "clerk-of-circuit-court",
    "Judge of the Circuit Court":    "circuit-court-judge",
    "Judge of the Orphans Court":    "orphans-court-judge",
    "County Treasurer":              "county-treasurer",
    "Governor":                      "governor",
    "Governor/Lieutenant Governor":  "governor",
    "Attorney General":              "attorney-general",
    "State Senator":                 "state-senator",
    "House of Delegates":            "house-of-delegates-member",
    "U.S. Senator":                  "us-senator",
    "U.S. Representative":           "us-representative",
}

JURISDICTION_SLUG_MAP: dict[str, str] = {
    "Allegany":         "allegany-county",
    "Anne Arundel":     "anne-arundel-county",
    "Baltimore City":   "baltimore-city",
    "Baltimore County": "baltimore-county",
    "Calvert":          "calvert-county",
    "Caroline":         "caroline-county",
    "Carroll":          "carroll-county",
    "Cecil":            "cecil-county",
    "Charles":          "charles-county",
    "Dorchester":       "dorchester-county",
    "Frederick":        "frederick-county",
    "Garrett":          "garrett-county",
    "Harford":          "harford-county",
    "Howard":           "howard-county",
    "Kent":             "kent-county",
    "Montgomery":       "montgomery-county",
    "Prince George's":  "prince-georges-county",
    "Queen Anne's":     "queen-annes-county",
    "St. Mary's":       "saint-marys-county",
    "Somerset":         "somerset-county",
    "Talbot":           "talbot-county",
    "Washington":       "washington-county",
    "Wicomico":         "wicomico-county",
    "Worcester":        "worcester-county",
    "Maryland State":   "maryland-statewide",
}

OFFICE_SLUG_MAP_NORMALIZED = {
    " ".join(key.replace("\u2018", "'").replace("\u2019", "'").split()).casefold(): value
    for key, value in OFFICE_SLUG_MAP.items()
}

JURISDICTION_SLUG_MAP_NORMALIZED = {
    " ".join(key.replace("\u2018", "'").replace("\u2019", "'").split()).casefold(): value
    for key, value in JURISDICTION_SLUG_MAP.items()
}

# Contributor types treated as individual donations
INDIVIDUAL_TYPES = {"Individual", "Spouse"}
# Contributor types treated as self-funded
SELF_TYPES = {"Self"}
# Everything else (PAC, business, org, etc.) counts as business_pac

INDIVIDUAL_TYPES_NORMALIZED = {value.casefold() for value in INDIVIDUAL_TYPES}
SELF_TYPES_NORMALIZED = {value.casefold() for value in SELF_TYPES}

NICKNAME_MAP: dict[str, str] = {
    "alex": "alexander",
    "andy": "andrew",
    "annie": "anne",
    "ben": "benjamin",
    "bill": "william",
    "billy": "william",
    "bob": "robert",
    "bobby": "robert",
    "cassi": "cassandra",
    "cassie": "cassandra",
    "cate": "catherine",
    "cathy": "catherine",
    "chas": "charles",
    "chaz": "charles",
    "chris": "christopher",
    "chrissy": "christina",
    "dan": "daniel",
    "dani": "danielle",
    "danny": "daniel",
    "dave": "david",
    "debbie": "deborah",
    "denny": "dennis",
    "doug": "douglas",
    "gene": "eugene",
    "greg": "gregory",
    "jack": "john",
    "jake": "jacob",
    "jamie": "james",
    "jay": "jason",
    "jeff": "jeffrey",
    "jim": "james",
    "joe": "joseph",
    "jon": "jonathan",
    "jonny": "jonathan",
    "josh": "joshua",
    "kate": "kathryn",
    "katie": "kathleen",
    "kathy": "kathleen",
    "katie": "katherine",
    "liz": "elizabeth",
    "matt": "matthew",
    "mike": "michael",
    "nico": "nickalus",
    "pat": "patrick",
    "pete": "peter",
    "ray": "raymond",
    "regg": "reginald",
    "rick": "richard",
    "ricky": "richard",
    "rob": "robert",
    "ron": "ronald",
    "shelly": "shelley",
    "steve": "steven",
    "terry": "terence",
    "tom": "thomas",
    "tonya": "watonia",
    "trish": "patricia",
}


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class CommitteeInfo:
    filing_entity_id: str
    committee_name: str
    candidate_last: str
    candidate_first: str
    office_slug: str
    jurisdiction_slug: str
    district_hint: Optional[str] = None
    committee_email: Optional[str] = None
    website: Optional[str] = None


@dataclass
class FinanceSummary:
    committee: CommitteeInfo
    total_raised: float = 0.0
    total_spent: float = 0.0
    num_contributions: int = 0
    donor_keys: set = field(default_factory=set)   # set of (name, address) for unique count
    individual_total: float = 0.0
    business_pac_total: float = 0.0
    self_total: float = 0.0


@dataclass
class MatchResult:
    candidate: Optional[dict]
    reason: str
    top_scores: list[tuple[float, str, Optional[str]]]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_csv(path: Path) -> list[dict]:
    """Read a CSV whose first line is a metadata header (skip it), latin-1 encoded."""
    with open(path, encoding="latin-1") as f:
        lines = f.readlines()
    # Line 0 is a metadata line like "Committee Download as of ..."
    # Line 1 is the real header
    reader = csv.DictReader(io.StringIO("".join(lines[1:])))
    return list(reader)


def _parse_amount(raw: str) -> float:
    """Parse '$1,234.56' → 1234.56. Returns 0.0 on failure."""
    try:
        return float(raw.strip().replace(",", "").replace("$", ""))
    except (ValueError, AttributeError):
        return 0.0


def _extract_date(filename: str) -> Optional[date]:
    """Try to pull a date from the filename like '04_13_2026'."""
    m = re.search(r"(\d{2})_(\d{2})_(\d{4})", filename)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
        except ValueError:
            pass
    return None


def normalize_name(name: str) -> str:
    name = unicodedata.normalize("NFKD", name)
    name = "".join(ch for ch in name if not unicodedata.combining(ch))
    name = name.encode("latin-1", errors="ignore").decode("utf-8", errors="ignore") or name
    name = name.casefold().strip()
    name = re.sub(r"""[.,\-'""\u2018\u2019\u201c\u201d]""", " ", name)
    name = re.sub(r"\s+", " ", name)
    parts = []
    for token in name.strip().split():
        if len(token) == 1:
            continue
        parts.append(NICKNAME_MAP.get(token, token))
    return " ".join(parts)


def is_matchable_candidate_name(name: Optional[str]) -> bool:
    if not name:
        return False
    normalized = normalize_lookup_key(name)
    blocked_phrases = (
        "candidacy for general election only",
        "general election only",
        "withdrawn",
        "disqualified",
    )
    return not any(phrase in normalized for phrase in blocked_phrases)


def normalize_lookup_key(text: Optional[str]) -> str:
    if not text:
        return ""
    cleaned = str(text).replace("\u2018", "'").replace("\u2019", "'")
    cleaned = " ".join(cleaned.split()).strip()
    return cleaned.casefold()


def normalize_district_name(text: Optional[str]) -> Optional[str]:
    if not text:
        return None

    raw = " ".join(str(text).split()).strip()
    if not raw:
        return None

    lower = raw.casefold()
    if "at large" in lower:
        return None

    match = re.search(r"(district|commissioner district)\s+([a-z0-9-]+)$", raw, re.IGNORECASE)
    if match:
        return f"District {match.group(2).upper()}"

    return raw


def infer_district_hint(*parts: Optional[str]) -> Optional[str]:
    text = " ".join(p for p in parts if p).strip()
    if not text:
        return None

    patterns = [
        r"\bdistrict[\s\-]*([0-9]{1,2}[a-z]?)\b",
        r"\b(?:dist|d|cd|ld)[\s\-]*([0-9]{1,2}[a-z]?)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return normalize_district_name(f"District {match.group(1)}")

    return None


def name_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, normalize_name(a), normalize_name(b)).ratio()


def rank_name_matches(query: str, candidates: list[dict]) -> list[tuple[float, dict]]:
    scored = [(name_similarity(query, c["full_name"]), c) for c in candidates]
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored


# ---------------------------------------------------------------------------
# Load and aggregate
# ---------------------------------------------------------------------------

def load_committees(finance_dir: Path) -> dict[str, CommitteeInfo]:
    """Return mapping filing_entity_id → CommitteeInfo for 2026 candidate committees."""
    files = list(finance_dir.glob("Committee Download*.csv"))
    if not files:
        log.error("No Committee Download CSV found in %s", finance_dir)
        sys.exit(1)
    path = files[0]
    log.info("Loading committees from %s", path.name)

    rows = _read_csv(path)
    committees: dict[str, CommitteeInfo] = {}
    skipped = 0

    for r in rows:
        eid = r.get("Filing Entity Id", "").strip()
        if not eid:
            continue

        # Only process 2026 election committees
        election = r.get("Election", "")
        if "2026" not in election:
            skipped += 1
            continue

        office_raw = r.get("Office Sought", "").strip()
        jur_raw = r.get("Jurisdiction", "").strip()

        office_slug = OFFICE_SLUG_MAP_NORMALIZED.get(normalize_lookup_key(office_raw))
        jur_slug = JURISDICTION_SLUG_MAP_NORMALIZED.get(normalize_lookup_key(jur_raw))

        if not office_slug or not jur_slug:
            log.debug("Skipping unmapped office/jurisdiction: %r / %r", office_raw, jur_raw)
            skipped += 1
            continue

        committees[eid] = CommitteeInfo(
            filing_entity_id=eid,
            committee_name=r.get("Committee Name", "").strip(),
            candidate_last=r.get("Candidate LastName", "").strip(),
            candidate_first=r.get("Candidate First Name", "").strip(),
            office_slug=office_slug,
            jurisdiction_slug=jur_slug,
            district_hint=infer_district_hint(
                r.get("Committee Name", "").strip(),
                r.get("Candidate Email", "").strip(),
                r.get("Website", "").strip(),
            ),
            committee_email=r.get("Candidate Email", "").strip() or None,
            website=r.get("Website", "").strip() or None,
        )

    log.info("Loaded %d mappable 2026 committees (%d skipped)", len(committees), skipped)
    return committees


def aggregate_contributions(
    finance_dir: Path,
    committees: dict[str, CommitteeInfo],
) -> dict[str, FinanceSummary]:
    """Aggregate contributions per committee."""
    files = list(finance_dir.glob("Contributions*Download*.csv"))
    if not files:
        log.error("No Contributions CSV found in %s", finance_dir)
        sys.exit(1)
    path = files[0]
    log.info("Aggregating contributions from %s", path.name)

    summaries: dict[str, FinanceSummary] = {
        eid: FinanceSummary(committee=info)
        for eid, info in committees.items()
    }

    rows_read = rows_matched = 0
    with open(path, encoding="latin-1") as f:
        lines = f.readlines()
    reader = csv.DictReader(io.StringIO("".join(lines[1:])))

    for r in reader:
        rows_read += 1
        eid = r.get("Filing Entity Id", "").strip()
        if eid not in summaries:
            continue

        amt = _parse_amount(r.get("Transaction Amount", ""))
        if amt <= 0:
            continue

        rows_matched += 1
        s = summaries[eid]
        s.total_raised += amt
        s.num_contributions += 1

        # Unique donor tracking
        donor_key = (
            r.get("Contributor Last Name", "").strip().lower(),
            r.get("Contributor First Name", "").strip().lower(),
            r.get("Contributor Mailing Address1", "").strip().lower(),
        )
        s.donor_keys.add(donor_key)

        # Contributor type breakdown
        ctype = normalize_lookup_key(r.get("Contributor Type", ""))
        if ctype in INDIVIDUAL_TYPES_NORMALIZED:
            s.individual_total += amt
        elif ctype in SELF_TYPES_NORMALIZED:
            s.self_total += amt
        else:
            s.business_pac_total += amt

    log.info("Processed %d contribution rows, %d matched to 2026 committees", rows_read, rows_matched)
    return summaries


def aggregate_expenditures(
    finance_dir: Path,
    summaries: dict[str, FinanceSummary],
) -> None:
    """Add expenditure totals in place."""
    files = list(finance_dir.glob("Expenditure*Download*.csv"))
    if not files:
        log.warning("No Expenditure CSV found in %s — spending data will be zero", finance_dir)
        return
    path = files[0]
    log.info("Aggregating expenditures from %s", path.name)

    rows_read = rows_matched = 0
    with open(path, encoding="latin-1") as f:
        lines = f.readlines()
    reader = csv.DictReader(io.StringIO("".join(lines[1:])))

    for r in reader:
        rows_read += 1
        eid = r.get("Filing Entity Id", "").strip()
        if eid not in summaries:
            continue
        amt = _parse_amount(r.get("Transaction Amount", ""))
        if amt <= 0:
            continue
        rows_matched += 1
        summaries[eid].total_spent += amt

    log.info("Processed %d expenditure rows, %d matched to 2026 committees", rows_read, rows_matched)


# ---------------------------------------------------------------------------
# DB matching
# ---------------------------------------------------------------------------

def load_candidate_index(supabase) -> list[dict]:
    rows = []
    page_size = 1000
    offset = 0

    while True:
        result = supabase.table("candidates").select(
            "id, full_name, filing_status, "
            "contest:contests("
            "  district_name, "
            "  election_type, "
            "  office:offices(slug), "
            "  jurisdiction:jurisdictions(slug)"
            ")"
        ).eq("filing_status", "Active").range(offset, offset + page_size - 1).execute()

        batch = result.data or []
        if not batch:
            break

        for row in batch:
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
                "office_slug": office["slug"] if office else None,
                "jurisdiction_slug": jurisdiction["slug"] if jurisdiction else None,
                "district_name": contest.get("district_name"),
                "district_name_normalized": normalize_district_name(contest.get("district_name")),
                "full_name_normalized": normalize_name(row["full_name"]),
                "election_type": contest.get("election_type"),
            })

        if len(batch) < page_size:
            break
        offset += page_size

    log.info("Loaded %d active candidates from DB", len(rows))
    return rows


def match_summary_to_candidate(
    summary: FinanceSummary,
    candidate_index: list[dict],
    threshold: float,
) -> MatchResult:
    """Find the DB candidate matching this committee's candidate."""
    committee = summary.committee
    sbe_name = f"{summary.committee.candidate_first} {summary.committee.candidate_last}".strip()
    if not sbe_name:
        return MatchResult(candidate=None, reason="missing_name", top_scores=[])

    sbe_name_normalized = normalize_name(sbe_name)

    # Filter by office + jurisdiction first.
    pool = [
        c for c in candidate_index
        if c["office_slug"] == committee.office_slug
        and c["jurisdiction_slug"] == committee.jurisdiction_slug
        and is_matchable_candidate_name(c["full_name"])
    ]

    if not pool:
        return MatchResult(candidate=None, reason="no_pool", top_scores=[])

    if committee.district_hint:
        district_pool = [
            c for c in pool
            if c["district_name_normalized"] == committee.district_hint
        ]
        if district_pool:
            pool = district_pool

    exact_matches = [c for c in pool if c["full_name_normalized"] == sbe_name_normalized]
    if len(exact_matches) == 1:
        return MatchResult(candidate=exact_matches[0], reason="exact_name", top_scores=[])
    if len(exact_matches) > 1:
        top_scores = [
            (1.0, c["full_name"], c.get("district_name"))
            for c in exact_matches[:3]
        ]
        return MatchResult(candidate=None, reason="ambiguous_exact_name", top_scores=top_scores)

    ranked = rank_name_matches(sbe_name, pool)
    top_scores = [
        (score, cand["full_name"], cand.get("district_name"))
        for score, cand in ranked[:3]
    ]
    if not ranked:
        return MatchResult(candidate=None, reason="empty_pool", top_scores=top_scores)

    best_score, best_candidate = ranked[0]
    runner_up_score = ranked[1][0] if len(ranked) > 1 else None

    if best_score < threshold:
        best_district = best_candidate.get("district_name_normalized")
        district_matches = (
            committee.district_hint is not None
            and best_district == committee.district_hint
        )
        if (
            best_score >= 0.78
            and district_matches
            and (runner_up_score is None or (best_score - runner_up_score) >= 0.08)
        ):
            return MatchResult(candidate=best_candidate, reason="near_threshold_district", top_scores=top_scores)
        return MatchResult(candidate=None, reason="below_threshold", top_scores=top_scores)

    if runner_up_score is not None and (best_score - runner_up_score) < 0.03:
        return MatchResult(candidate=None, reason="ambiguous_fuzzy", top_scores=top_scores)

    return MatchResult(candidate=best_candidate, reason="fuzzy_name", top_scores=top_scores)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(apply: bool, threshold: float, finance_dir: Path) -> None:
    # Detect data_as_of from filename
    committee_files = list(finance_dir.glob("Committee Download*.csv"))
    data_as_of = _extract_date(committee_files[0].name) if committee_files else None
    if data_as_of:
        log.info("Data as of: %s", data_as_of)

    committees = load_committees(finance_dir)
    summaries = aggregate_contributions(finance_dir, committees)
    aggregate_expenditures(finance_dir, summaries)

    supabase = get_client()
    candidate_index = load_candidate_index(supabase)

    matched: list[dict] = []
    no_match: list[FinanceSummary] = []
    unmatched_reasons: dict[str, int] = {}

    for eid, summary in summaries.items():
        match = match_summary_to_candidate(summary, candidate_index, threshold)
        candidate = match.candidate
        if candidate:
            similarity = name_similarity(
                f"{summary.committee.candidate_first} {summary.committee.candidate_last}",
                candidate["full_name"],
            )
            log.info(
                "  MATCH [%.2f] %-30s → %-30s  raised=$%.0f  spent=$%.0f  (%s%s)",
                similarity,
                f"{summary.committee.candidate_first} {summary.committee.candidate_last}",
                candidate["full_name"],
                summary.total_raised,
                summary.total_spent,
                match.reason,
                f", {summary.committee.district_hint}" if summary.committee.district_hint else "",
            )
            matched.append({
                "candidate_id": candidate["id"],
                "summary": summary,
            })
        else:
            no_match.append(summary)
            unmatched_reasons[match.reason] = unmatched_reasons.get(match.reason, 0) + 1
            top = "; ".join(
                f"{name} [{score:.2f}{', ' + district if district else ''}]"
                for score, name, district in match.top_scores
            )
            log.warning(
                "  NO MATCH (%s) %-30s  %s / %s%s%s",
                match.reason,
                f"{summary.committee.candidate_first} {summary.committee.candidate_last}",
                summary.committee.office_slug,
                summary.committee.jurisdiction_slug,
                f" / {summary.committee.district_hint}" if summary.committee.district_hint else "",
                f" | top: {top}" if top else "",
            )

    log.info("\n%d matched, %d unmatched", len(matched), len(no_match))

    if no_match:
        log.warning("%d committees had no candidate match:", len(no_match))
        for s in no_match:
            log.warning(
                "  %-30s  %s / %s",
                f"{s.committee.candidate_first} {s.committee.candidate_last}",
                s.committee.office_slug,
                s.committee.jurisdiction_slug,
            )
        for reason, count in sorted(unmatched_reasons.items()):
            log.warning("  unmatched reason %-22s %d", reason, count)

    if not matched:
        log.info("Nothing to write.")
        return

    if not apply:
        log.info("DRY RUN — %d records would be upserted. Re-run with --apply to write.", len(matched))
        return

    upserted = 0
    for item in matched:
        s: FinanceSummary = item["summary"]
        row = {
            "candidate_id":       item["candidate_id"],
            "filing_entity_id":   s.committee.filing_entity_id,
            "committee_name":     s.committee.committee_name,
            "total_raised":       round(s.total_raised, 2),
            "total_spent":        round(s.total_spent, 2),
            "num_contributions":  s.num_contributions,
            "num_donors":         len(s.donor_keys),
            "individual_total":   round(s.individual_total, 2),
            "business_pac_total": round(s.business_pac_total, 2),
            "self_total":         round(s.self_total, 2),
            "data_as_of":         data_as_of.isoformat() if data_as_of else None,
            "updated_at":         "now()",
        }
        supabase.table("candidate_finance").upsert(row, on_conflict="candidate_id").execute()
        upserted += 1

    log.info("Upserted %d candidate_finance rows.", upserted)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest MD SBE campaign finance data.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", dest="apply", action="store_false", default=False)
    mode.add_argument("--apply", dest="apply", action="store_true")
    parser.add_argument("--threshold", type=float, default=0.82)
    parser.add_argument(
        "--finance-dir",
        type=Path,
        default=DEFAULT_FINANCE_DIR,
        help="Directory containing the three SBE CSV export files.",
    )
    args = parser.parse_args()

    log.info("=== ingest_finance.py (apply=%s, threshold=%.2f) ===", args.apply, args.threshold)
    log.info("Finance dir: %s", args.finance_dir)
    try:
        run(apply=args.apply, threshold=args.threshold, finance_dir=args.finance_dir)
        log.info("Done.")
        sys.exit(0)
    except Exception as e:
        log.error("Fatal: %s", e, exc_info=True)
        sys.exit(1)
