// ─────────────────────────────────────────────────────────────────────────────
// MarylandIQ — TypeScript types derived from database/schema.sql
// Keep in sync with any schema changes.
// ─────────────────────────────────────────────────────────────────────────────

// ── Jurisdictions ────────────────────────────────────────────────────────────

export type JurisdictionType = "county" | "city";

export interface Jurisdiction {
  id: string;
  slug: string;
  name: string;
  type: JurisdictionType;
  sbe_jurisdiction_id: string | null;
  county_board_url: string | null;
}

// ── Offices ──────────────────────────────────────────────────────────────────

export type ExplainerSource = "official" | "ai_generated";

export interface Office {
  id: string;
  slug: string;
  name: string;
  explainer_text: string | null;
  explainer_source: ExplainerSource | null;
  explainer_generated_at: string | null; // ISO timestamptz
}

// ── Contests ─────────────────────────────────────────────────────────────────

export type ElectionType = "primary" | "general" | "special";

export interface Contest {
  id: string;
  slug: string;
  office_id: string;
  jurisdiction_id: string;
  district_name: string | null;
  election_date: string; // ISO date: YYYY-MM-DD
  election_type: ElectionType;
  seats_available: number;
  sbe_contest_id: string | null;
  last_scraped_at: string | null;
}

/** Contest with its related office and jurisdiction joined in */
export interface ContestWithRelations extends Contest {
  office: Office;
  jurisdiction: Jurisdiction;
}

// ── Precincts ─────────────────────────────────────────────────────────────────

export interface Precinct {
  id: string;
  precinct_code: string;
  jurisdiction_id: string;
  // geometry is PostGIS — not returned as a plain object in normal queries
  source_url: string | null;
  loaded_at: string | null;
}

// ── Candidates ───────────────────────────────────────────────────────────────

export type FilingStatus = "Active" | "Withdrawn" | "Disqualified";

export interface Candidate {
  id: string;
  slug: string;
  contest_id: string;
  full_name: string;
  party: string | null;
  filing_status: FilingStatus;
  filed_date: string | null; // ISO date
  sbe_candidate_id: string;
  campaign_website_url: string | null;
  facebook_url: string | null;
  twitter_handle: string | null;
  linkedin_url: string | null;
  is_incumbent: boolean;
  completeness_score: number; // 0–100
  last_scraped_at: string | null;
  withdrawn_detected_at: string | null;
}

/** Candidate with contest + office + jurisdiction joined */
export interface CandidateWithRelations extends Candidate {
  contest: ContestWithRelations;
}

// ── Candidate Enrichment ─────────────────────────────────────────────────────

export type EnrichmentConfidence = "high" | "medium" | "low";

export interface AiSummarySource {
  url: string;
  label: string;
}

export interface IssueTagSource {
  tag: string;
  quote_snippet: string;
  source_url: string;
}

export interface CandidateEnrichment {
  candidate_id: string;
  scraped_website_text: string | null;
  scrape_method: "requests" | "playwright" | null;
  scrape_error: boolean;
  ai_summary: string | null;
  ai_summary_sources: AiSummarySource[];
  inferred_from_social: boolean;
  social_inference_text: string | null;
  issue_tags: string[];
  issue_tag_sources: IssueTagSource[];
  enrichment_confidence: EnrichmentConfidence | null;
  website_scraped_at: string | null;
  social_scraped_at: string | null;
  ai_generated_at: string | null;
  enrichment_version: number;
}

/** Full candidate profile — candidate row + enrichment joined */
export interface CandidateProfile extends CandidateWithRelations {
  enrichment: CandidateEnrichment | null;
}

// ── Ballot Measures ───────────────────────────────────────────────────────────

export interface BallotMeasure {
  id: string;
  slug: string;
  jurisdiction_id: string;
  title: string;
  official_text: string | null;
  plain_language_summary: string | null;
  summary_generated_at: string | null;
  source_url: string | null;
  election_date: string; // ISO date
}

export interface BallotMeasureWithJurisdiction extends BallotMeasure {
  jurisdiction: Jurisdiction;
}

// ── Corrections ───────────────────────────────────────────────────────────────

export type IssueType = "wrong_info" | "outdated" | "missing" | "other";
export type CorrectionStatus = "open" | "resolved" | "dismissed";

export interface Correction {
  id: string;
  page_url: string;
  reporter_email: string | null;
  issue_type: IssueType;
  description: string;
  status: CorrectionStatus;
  created_at: string;
  resolved_at: string | null;
}

/** Shape of the POST body sent to /api/report */
export interface CorrectionSubmission {
  page_url: string;
  reporter_email?: string;
  issue_type: IssueType;
  description: string;
}

// ── Ballot Lookup ─────────────────────────────────────────────────────────────

/** Result shape returned by /api/ballot-lookup */
export interface BallotLookupResult {
  precinct_code: string;
  jurisdiction: Jurisdiction;
  contests: ContestWithRelations[];
}

// ── Search ────────────────────────────────────────────────────────────────────

/** Result shape returned by /api/search */
export interface SearchResult {
  type: "candidate" | "contest" | "jurisdiction";
  slug: string;
  display_name: string;
  subtitle: string;
  href: string;
}

// ── Static data constants ─────────────────────────────────────────────────────

/** All 24 Maryland county jurisdictions — static, used in browse pages */
export const MD_JURISDICTIONS: Pick<Jurisdiction, "name" | "slug">[] = [
  { name: "Allegany County", slug: "allegany-county" },
  { name: "Anne Arundel County", slug: "anne-arundel-county" },
  { name: "Baltimore City", slug: "baltimore-city" },
  { name: "Baltimore County", slug: "baltimore-county" },
  { name: "Calvert County", slug: "calvert-county" },
  { name: "Caroline County", slug: "caroline-county" },
  { name: "Carroll County", slug: "carroll-county" },
  { name: "Cecil County", slug: "cecil-county" },
  { name: "Charles County", slug: "charles-county" },
  { name: "Dorchester County", slug: "dorchester-county" },
  { name: "Frederick County", slug: "frederick-county" },
  { name: "Garrett County", slug: "garrett-county" },
  { name: "Harford County", slug: "harford-county" },
  { name: "Howard County", slug: "howard-county" },
  { name: "Kent County", slug: "kent-county" },
  { name: "Montgomery County", slug: "montgomery-county" },
  { name: "Prince George's County", slug: "prince-georges-county" },
  { name: "Queen Anne's County", slug: "queen-annes-county" },
  { name: "Somerset County", slug: "somerset-county" },
  { name: "St. Mary's County", slug: "st-marys-county" },
  { name: "Talbot County", slug: "talbot-county" },
  { name: "Washington County", slug: "washington-county" },
  { name: "Wicomico County", slug: "wicomico-county" },
  { name: "Worcester County", slug: "worcester-county" },
];

/** Office types on the 2026 ballot — static, all levels */
export const MD_OFFICES: Pick<Office, "name" | "slug">[] = [
  // Federal
  { name: "U.S. Senator", slug: "us-senator" },
  { name: "U.S. Representative", slug: "us-representative" },
  // Statewide
  { name: "Governor", slug: "governor" },
  { name: "Attorney General", slug: "attorney-general" },
  { name: "Comptroller", slug: "comptroller" },
  // State Legislative
  { name: "State Senator", slug: "state-senator" },
  { name: "House of Delegates", slug: "house-of-delegates" },
  // County
  { name: "County Executive", slug: "county-executive" },
  { name: "County Council Member", slug: "county-council-member" },
  { name: "Board of Education Member", slug: "board-of-education-member" },
  { name: "Sheriff", slug: "sheriff" },
  { name: "State's Attorney", slug: "states-attorney" },
  { name: "Register of Wills", slug: "register-of-wills" },
  { name: "Clerk of Circuit Court", slug: "clerk-of-circuit-court" },
  { name: "Circuit Court Judge", slug: "circuit-court-judge" },
  { name: "Orphans' Court Judge", slug: "orphans-court-judge" },
];
