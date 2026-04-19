import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export interface PolicyPriority {
  priority: string;
  description: string;
  source_snippet: string;
}

export interface IssueTagEvidence {
  tag: string;
  quote_snippet: string;
  source_url: string;
}

export interface CandidateFinance {
  total_raised: number;
  total_spent: number;
  cash_on_hand: number;
  num_contributions: number;
  num_donors: number;
  individual_total: number;
  business_pac_total: number;
  self_total: number;
  data_as_of: string | null;
}

export interface CandidateDetailResult {
  id: string;
  slug: string;
  full_name: string;
  party: string | null;
  filing_status: string;
  filed_date: string | null;
  campaign_website_url: string | null;
  facebook_url: string | null;
  twitter_handle: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  threads_url: string | null;
  completeness_score: number;
  is_incumbent: boolean;
  finance: CandidateFinance | null;

  contest_slug: string | null;
  election_type: string | null;
  election_date: string | null;
  district_name: string | null;
  office_name: string | null;
  office_slug: string | null;
  office_explainer: string | null;
  jurisdiction_name: string | null;
  jurisdiction_slug: string | null;

  // Enrichment
  ai_summary: string | null;
  campaign_voice: string | null;
  news_summary: string | null;
  policy_priorities: PolicyPriority[];
  issue_tags: string[];
  issue_tag_sources: IssueTagEvidence[];
  enrichment_confidence: string | null;
  news_article_urls: string[];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("candidates")
    .select(
      `
      id, slug, full_name, party, filing_status, filed_date,
      campaign_website_url, facebook_url, twitter_handle,
      linkedin_url, instagram_url, threads_url,
      completeness_score, is_incumbent,
      contest:contests!inner(
        slug, election_type, election_date, district_name,
        office:offices!inner(name, slug, explainer_text),
        jurisdiction:jurisdictions!inner(name, slug)
      ),
      news_article_urls,
      enrichment:candidate_enrichment(
        ai_summary, campaign_voice, news_summary,
        policy_priorities, issue_tags, issue_tag_sources,
        enrichment_confidence
      ),
      finance:candidate_finance(
        total_raised, total_spent, cash_on_hand,
        num_contributions, num_donors,
        individual_total, business_pac_total, self_total,
        data_as_of
      )
      `
    )
    .eq("slug", slug)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contest = Array.isArray(data.contest) ? data.contest[0] : data.contest;
  const off = contest
    ? Array.isArray(contest.office)
      ? contest.office[0]
      : contest.office
    : null;
  const jur = contest
    ? Array.isArray(contest.jurisdiction)
      ? contest.jurisdiction[0]
      : contest.jurisdiction
    : null;
  const enr = Array.isArray(data.enrichment)
    ? data.enrichment[0] ?? null
    : data.enrichment ?? null;
  const fin = Array.isArray((data as any).finance)
    ? (data as any).finance[0] ?? null
    : (data as any).finance ?? null;

  const result: CandidateDetailResult = {
    id: data.id,
    slug: data.slug,
    full_name: data.full_name,
    party: data.party ?? null,
    filing_status: data.filing_status,
    filed_date: data.filed_date ?? null,
    campaign_website_url: data.campaign_website_url ?? null,
    facebook_url: data.facebook_url ?? null,
    twitter_handle: data.twitter_handle ?? null,
    linkedin_url: data.linkedin_url ?? null,
    instagram_url: data.instagram_url ?? null,
    threads_url: data.threads_url ?? null,
    completeness_score: data.completeness_score ?? 0,
    is_incumbent: (data as any).is_incumbent ?? false,

    contest_slug: contest?.slug ?? null,
    election_type: contest?.election_type ?? null,
    election_date: contest?.election_date ?? null,
    district_name: contest?.district_name ?? null,
    office_name: off?.name ?? null,
    office_slug: off?.slug ?? null,
    office_explainer: off?.explainer_text ?? null,
    jurisdiction_name: jur?.name ?? null,
    jurisdiction_slug: jur?.slug ?? null,

    finance: fin ? {
      total_raised:       fin.total_raised ?? 0,
      total_spent:        fin.total_spent ?? 0,
      cash_on_hand:       fin.cash_on_hand ?? 0,
      num_contributions:  fin.num_contributions ?? 0,
      num_donors:         fin.num_donors ?? 0,
      individual_total:   fin.individual_total ?? 0,
      business_pac_total: fin.business_pac_total ?? 0,
      self_total:         fin.self_total ?? 0,
      data_as_of:         fin.data_as_of ?? null,
    } : null,

    ai_summary: enr?.ai_summary ?? null,
    campaign_voice: enr?.campaign_voice ?? null,
    news_summary: enr?.news_summary ?? null,
    policy_priorities: enr?.policy_priorities ?? [],
    issue_tags: enr?.issue_tags ?? [],
    issue_tag_sources: enr?.issue_tag_sources ?? [],
    enrichment_confidence: enr?.enrichment_confidence ?? null,
    news_article_urls: (data as any).news_article_urls ?? [],
  };

  return NextResponse.json(result, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
