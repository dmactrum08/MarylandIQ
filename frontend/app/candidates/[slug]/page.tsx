import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase-server";
import PageHeader from "@/components/PageHeader";
import TrustLabel from "@/components/TrustLabel";
import type {
  Candidate,
  CandidateEnrichment,
  Contest,
  Office,
  Jurisdiction,
  IssueTagSource,
  AiSummarySource,
} from "@/lib/types";

interface PolicyPriority {
  priority: string;
  description: string;
  source_snippet?: string;
}

// ─── ISR ──────────────────────────────────────────────────────────────────────

export const revalidate = 3600;

// ─── Types ────────────────────────────────────────────────────────────────────

interface CandidateFull extends Candidate {
  enrichment: CandidateEnrichment | null;
  contest: (Contest & {
    office: Office;
    jurisdiction: Jurisdiction;
  }) | null;
}

// ─── Static params ────────────────────────────────────────────────────────────

export async function generateStaticParams() {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("candidates")
    .select("slug")
    .eq("filing_status", "Active");

  return (data ?? []).map((row: { slug: string }) => ({ slug: row.slug }));
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const supabase = createServerClient();
  const { data } = await supabase
    .from("candidates")
    .select("full_name, party, contest:contests(office:offices(name), jurisdiction:jurisdictions(name))")
    .eq("slug", slug)
    .single();

  if (!data) return { title: "Candidate not found" };

  const contest = Array.isArray(data.contest) ? data.contest[0] : data.contest;
  const office = Array.isArray(contest?.office) ? contest.office[0] : contest?.office;
  const jurisdiction = Array.isArray(contest?.jurisdiction) ? contest.jurisdiction[0] : contest?.jurisdiction;

  const title = data.full_name;
  const description = [
    data.party,
    office?.name,
    jurisdiction?.name,
    "2026 Maryland election",
  ]
    .filter(Boolean)
    .join(" · ");

  return { title, description };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function electionLabel(type: string) {
  if (type === "primary") return "2026 Primary";
  if (type === "general") return "2026 General";
  return "2026 Special Election";
}

function partyColor(party: string | null) {
  if (!party) return "bg-slate-100 text-slate-700";
  const p = party.toLowerCase();
  if (p.includes("democrat")) return "bg-blue-100 text-blue-800";
  if (p.includes("republican")) return "bg-red-100 text-red-800";
  if (p.includes("green")) return "bg-green-100 text-green-800";
  if (p.includes("libertarian")) return "bg-yellow-100 text-yellow-800";
  return "bg-slate-100 text-slate-700";
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="text-base font-semibold text-[#0F172A]">{children}</h2>
      {label}
    </div>
  );
}

function NoInfoBox({ message }: { message: string }) {
  return (
    <div className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-xl">
      <p className="text-sm text-[#94a3b8] italic">{message}</p>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-[#CC0000] hover:underline font-medium focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
    >
      {children}
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
    </a>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CandidatePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("candidates")
    .select(`
      *,
      enrichment:candidate_enrichment(*),
      contest:contests(
        *,
        office:offices(*),
        jurisdiction:jurisdictions(*)
      )
    `)
    .eq("slug", slug)
    .single();

  if (error || !data) notFound();

  const candidate = data as CandidateFull;
  const contest = Array.isArray(candidate.contest) ? candidate.contest[0] : candidate.contest;
  const office = contest ? (Array.isArray(contest.office) ? contest.office[0] : contest.office) : null;
  const jurisdiction = contest ? (Array.isArray(contest.jurisdiction) ? contest.jurisdiction[0] : contest.jurisdiction) : null;
  const enrichment = Array.isArray(candidate.enrichment) ? candidate.enrichment[0] : candidate.enrichment;

  const hasWebsite = !!candidate.campaign_website_url;
  const hasFacebook = !!candidate.facebook_url;
  const hasTwitter = !!candidate.twitter_handle;
  const hasLinkedIn = !!candidate.linkedin_url;
  const hasInstagram = !!(candidate as any).instagram_url;
  const hasThreads = !!(candidate as any).threads_url;
  const hasSocialLinks = hasWebsite || hasFacebook || hasTwitter || hasLinkedIn || hasInstagram || hasThreads;

  const hasAiSummary = !!enrichment?.ai_summary;
  const hasCampaignVoice = !!(enrichment as any)?.campaign_voice;
  const hasNewsSummary = !!(enrichment as any)?.news_summary;
  const policyPriorities: PolicyPriority[] = (enrichment as any)?.policy_priorities ?? [];
  const newsArticleUrls: string[] = candidate.news_article_urls ?? [];
  const hasIssueTags = (enrichment?.issue_tags ?? []).length > 0;
  const hasSocialInference = !!enrichment?.inferred_from_social && !!enrichment?.social_inference_text;
  const isWithdrawn = candidate.filing_status !== "Active";

  function twitterUrl(handle: string) {
    return handle.startsWith("http") ? handle : `https://x.com/${handle.replace(/^@/, "")}`;
  }

  function siteHostname(url: string) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
  }

  return (
    <main aria-labelledby="candidate-heading" className="flex-1">

      <PageHeader
        title={candidate.full_name}
        subtitle={[
          office?.name,
          contest?.district_name,
          jurisdiction?.name,
          contest ? electionLabel(contest.election_type) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Candidates", href: "/candidates" },
          ...(jurisdiction
            ? [{ label: jurisdiction.name, href: `/counties/${jurisdiction.slug}` }]
            : []),
        ]}
      />

      <div className="bg-white flex-1">
        <div className="max-w-5xl 2xl:max-w-[1100px] 3xl:max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-10">

          {/* Withdrawn banner */}
          {isWithdrawn && (
            <div className="mb-8 flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
              <svg className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-sm text-amber-800">
                <span className="font-semibold">This candidate has {candidate.filing_status.toLowerCase()}.</span>{" "}
                Information below reflects their filing at the time of withdrawal.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* ── Main column ── */}
            <div className="lg:col-span-2 space-y-10">

              {/* Office explainer */}
              {office?.explainer_text && (
                <section aria-labelledby="office-heading">
                  <SectionHeader
                    label={
                      <TrustLabel
                        variant={office.explainer_source === "official" ? "official" : "machine"}
                      />
                    }
                  >
                    About this office
                  </SectionHeader>
                  <div className="p-5 bg-[#F8FAFC] border border-gray-200 rounded-xl">
                    <p className="text-sm text-[#475569] leading-relaxed">{office.explainer_text}</p>
                    {contest && (
                      <a
                        href={`/races/${contest.slug}`}
                        className="inline-flex items-center gap-1 mt-3 text-xs font-medium text-[#CC0000] hover:underline focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
                      >
                        View all candidates in this race
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                      </a>
                    )}
                  </div>
                </section>
              )}

              {/* AI Summary */}
              <section aria-labelledby="summary-heading">
                <SectionHeader label={<TrustLabel variant="machine" />}>
                  About this candidate
                </SectionHeader>
                {hasAiSummary ? (
                  <div className="space-y-3">
                    <p className="text-sm text-[#0F172A] leading-relaxed">{enrichment!.ai_summary}</p>
                    {(enrichment!.ai_summary_sources as AiSummarySource[]).length > 0 && (
                      <p className="text-xs text-[#94a3b8]">
                        Sources:{" "}
                        {(enrichment!.ai_summary_sources as AiSummarySource[]).map((s, i) => (
                          <span key={s.url}>
                            {i > 0 && ", "}
                            <ExternalLink href={s.url}>{s.label}</ExternalLink>
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                ) : hasSocialInference ? (
                  <div className="space-y-3">
                    <p className="text-sm text-[#0F172A] leading-relaxed">{enrichment!.social_inference_text}</p>
                  </div>
                ) : (
                  <NoInfoBox message="No public information found beyond the official filing. This candidate does not appear to have a campaign website or public social media presence." />
                )}
              </section>

              {/* In their own words */}
              {hasCampaignVoice && (
                <section aria-labelledby="campaign-voice-heading">
                  <SectionHeader label={<TrustLabel variant="candidate" />}>
                    In their own words
                  </SectionHeader>
                  <div className="p-5 bg-[#F8FAFC] border border-gray-200 rounded-xl space-y-4">
                    {((enrichment as any).campaign_voice as string)
                      .split(/\n\n+/)
                      .filter((s: string) => s.trim())
                      .map((snippet: string, i: number) => (
                        <blockquote
                          key={i}
                          className="pl-4 border-l-2 border-[#CC0000] text-sm text-[#0F172A] leading-relaxed italic"
                        >
                          {snippet.trim()}
                        </blockquote>
                      ))}
                    {hasWebsite && (
                      <p className="text-xs text-[#94a3b8] pt-1">
                        Source:{" "}
                        <a
                          href={candidate.campaign_website_url!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-[#CC0000] underline underline-offset-2"
                        >
                          {siteHostname(candidate.campaign_website_url!)}
                        </a>
                      </p>
                    )}
                  </div>
                </section>
              )}

              {/* Key priorities */}
              {policyPriorities.length > 0 && (
                <section aria-labelledby="priorities-heading">
                  <SectionHeader label={<TrustLabel variant="candidate" />}>
                    Key priorities
                  </SectionHeader>
                  <div className="space-y-3">
                    {policyPriorities.map((p: PolicyPriority, i: number) => (
                      <div
                        key={i}
                        className="p-4 border border-gray-200 rounded-xl bg-white hover:border-gray-300 transition-colors"
                      >
                        <p className="text-sm font-semibold text-[#0F172A] mb-1">{p.priority}</p>
                        <p className="text-sm text-[#475569] leading-relaxed mb-2">{p.description}</p>
                        {p.source_snippet && (
                          <blockquote className="pl-3 border-l-2 border-gray-200 text-xs text-[#94a3b8] italic">
                            &ldquo;{p.source_snippet}&rdquo;
                          </blockquote>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* In the news */}
              {(hasNewsSummary || newsArticleUrls.length > 0) && (
                <section aria-labelledby="news-heading">
                  <SectionHeader label={<TrustLabel variant="inferred" label="News coverage" />}>
                    In the news
                  </SectionHeader>
                  <div className="p-5 bg-[#F8FAFC] border border-gray-200 rounded-xl">
                    {hasNewsSummary && (
                      <p className="text-sm text-[#475569] leading-relaxed mb-4">
                        {(enrichment as any).news_summary}
                      </p>
                    )}
                    {newsArticleUrls.length > 0 && (
                      <ul className="space-y-2">
                        {newsArticleUrls.map((url: string, i: number) => (
                          <li key={i} className="flex items-start gap-2">
                            <svg className="w-3.5 h-3.5 text-[#94a3b8] mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-[#475569] hover:text-[#CC0000] underline underline-offset-2 break-all"
                            >
                              {siteHostname(url)}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              )}

              {/* Issue tags */}
              <section aria-labelledby="tags-heading">
                <SectionHeader label={<TrustLabel variant="machine" />}>
                  Issue areas
                </SectionHeader>
                {hasIssueTags ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2" role="list" aria-label="Issue tags">
                      {(enrichment!.issue_tags).map((tag: string) => (
                        <span
                          key={tag}
                          role="listitem"
                          className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-slate-100 text-slate-700 border border-slate-200"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    {/* Tag sources */}
                    <details className="group">
                      <summary className="text-xs text-[#94a3b8] cursor-pointer hover:text-[#475569] transition-colors list-none flex items-center gap-1 focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded">
                        <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                        Show source quotes
                      </summary>
                      <div className="mt-3 space-y-2">
                        {(enrichment!.issue_tag_sources as IssueTagSource[]).map((src, i) => (
                          <div key={i} className="flex items-start gap-3 p-3 bg-[#F8FAFC] border border-gray-100 rounded-lg">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 shrink-0">
                              {src.tag}
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs text-[#475569] leading-relaxed italic mb-1">&ldquo;{src.quote_snippet}&rdquo;</p>
                              <ExternalLink href={src.source_url}>Source</ExternalLink>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                ) : (
                  <NoInfoBox message="No issue areas identified. No public statements or campaign material were available." />
                )}
              </section>

            </div>

            {/* ── Sidebar ── */}
            <aside className="space-y-6" aria-label="Candidate details">

              {/* Filing info */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-[#F8FAFC] border-b border-gray-200">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
                    Filing information
                  </h2>
                  <TrustLabel variant="official" />
                </div>
                <dl className="divide-y divide-gray-100">
                  <div className="flex items-start gap-2 px-4 py-3">
                    <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Status</dt>
                    <dd className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                        isWithdrawn
                          ? "bg-amber-100 text-amber-800"
                          : "bg-green-100 text-green-800"
                      }`}>
                        {candidate.filing_status}
                      </span>
                      {candidate.is_incumbent && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-700 text-white">
                          Incumbent
                        </span>
                      )}
                    </dd>
                  </div>
                  {candidate.party && (
                    <div className="flex items-start gap-2 px-4 py-3">
                      <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Party</dt>
                      <dd>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${partyColor(candidate.party)}`}>
                          {candidate.party}
                        </span>
                      </dd>
                    </div>
                  )}
                  {office && (
                    <div className="flex items-start gap-2 px-4 py-3">
                      <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Office</dt>
                      <dd className="text-sm text-[#0F172A]">{office.name}</dd>
                    </div>
                  )}
                  {contest?.district_name && (
                    <div className="flex items-start gap-2 px-4 py-3">
                      <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">District</dt>
                      <dd className="text-sm text-[#0F172A]">{contest.district_name}</dd>
                    </div>
                  )}
                  {jurisdiction && (
                    <div className="flex items-start gap-2 px-4 py-3">
                      <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">County</dt>
                      <dd>
                        <a href={`/counties/${jurisdiction.slug}`} className="text-sm text-[#CC0000] hover:underline focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded">
                          {jurisdiction.name}
                        </a>
                      </dd>
                    </div>
                  )}
                  {contest && (
                    <div className="flex items-start gap-2 px-4 py-3">
                      <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Election</dt>
                      <dd className="text-sm text-[#0F172A]">
                        {electionLabel(contest.election_type)}
                        <span className="block text-xs text-[#94a3b8] mt-0.5">
                          {formatDate(contest.election_date)}
                        </span>
                      </dd>
                    </div>
                  )}
                  {candidate.filed_date && (
                    <div className="flex items-start gap-2 px-4 py-3">
                      <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Filed</dt>
                      <dd className="text-sm text-[#0F172A]">{formatDate(candidate.filed_date)}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Campaign links */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-[#F8FAFC] border-b border-gray-200">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
                    Campaign presence
                  </h2>
                  <TrustLabel variant="candidate" />
                </div>
                {hasSocialLinks ? (
                  <ul className="divide-y divide-gray-100">
                    {hasWebsite && (
                      <li className="px-4 py-3">
                        <ExternalLink href={candidate.campaign_website_url!}>
                          Campaign website
                        </ExternalLink>
                      </li>
                    )}
                    {hasFacebook && (
                      <li className="px-4 py-3">
                        <ExternalLink href={candidate.facebook_url!}>
                          Facebook page
                        </ExternalLink>
                      </li>
                    )}
                    {hasTwitter && (
                      <li className="px-4 py-3">
                        <ExternalLink href={twitterUrl(candidate.twitter_handle!)}>
                          X / Twitter
                        </ExternalLink>
                      </li>
                    )}
                    {hasLinkedIn && (
                      <li className="px-4 py-3">
                        <ExternalLink href={candidate.linkedin_url!}>
                          LinkedIn
                        </ExternalLink>
                      </li>
                    )}
                    {hasInstagram && (
                      <li className="px-4 py-3">
                        <ExternalLink href={(candidate as any).instagram_url}>
                          Instagram
                        </ExternalLink>
                      </li>
                    )}
                    {hasThreads && (
                      <li className="px-4 py-3">
                        <ExternalLink href={(candidate as any).threads_url}>
                          Threads
                        </ExternalLink>
                      </li>
                    )}
                  </ul>
                ) : (
                  <div className="px-4 py-3">
                    <p className="text-sm text-[#94a3b8] italic">No campaign website or public social media found.</p>
                  </div>
                )}
              </div>

              {/* View race */}
              {contest && (
                <a
                  href={`/races/${contest.slug}`}
                  className="flex items-center justify-between w-full px-4 py-3 border border-gray-200 rounded-xl hover:border-[#CC0000] hover:bg-[#FFF5F5] transition-all duration-150 group focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
                >
                  <div>
                    <p className="text-xs text-[#94a3b8] mb-0.5">View full race</p>
                    <p className="text-sm font-medium text-[#0F172A] group-hover:text-[#CC0000] transition-colors">
                      {office?.name}{contest.district_name ? ` · ${contest.district_name}` : ""}
                    </p>
                  </div>
                  <svg className="w-4 h-4 text-gray-300 group-hover:text-[#CC0000] transition-colors shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </a>
              )}

              {/* Report issue */}
              <a
                href={`/report?page=/candidates/${slug}`}
                className="flex items-center gap-2 w-full px-4 py-3 border border-gray-200 rounded-xl hover:border-gray-300 transition-colors text-sm text-[#94a3b8] hover:text-[#475569] focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l1.664 9.914M3 3h13.714M3 3L1.5 1.5M16.714 3l1.664 9.914M16.714 3H3M16.714 3l1.5-1.5M8.25 21a.75.75 0 100-1.5.75.75 0 000 1.5zm7.5 0a.75.75 0 100-1.5.75.75 0 000 1.5zM4.664 12.914h11.386" />
                </svg>
                Report an issue with this page
              </a>

            </aside>
          </div>

        </div>
      </div>

    </main>
  );
}
