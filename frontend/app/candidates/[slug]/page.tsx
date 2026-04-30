import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase-server";
import PageHeader from "@/components/PageHeader";
import TrustLabel from "@/components/TrustLabel";
import AdSlot from "@/components/AdSlot";
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
      finance:candidate_finance(*),
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
  const finance = Array.isArray((candidate as any).finance) ? (candidate as any).finance[0] ?? null : (candidate as any).finance ?? null;

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
  const hasAnyContent = hasAiSummary || hasSocialInference || hasCampaignVoice || hasNewsSummary || policyPriorities.length > 0 || hasIssueTags || newsArticleUrls.length > 0;
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

              {/* Summary */}
              {(hasAiSummary || hasSocialInference) && (
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
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-[#0F172A] leading-relaxed">{enrichment!.social_inference_text}</p>
                    </div>
                  )}
                </section>
              )}

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

              {/* No content fallback */}
              {!hasAnyContent && (
                <section aria-label="Limited information notice">
                  <div className="p-6 border border-dashed border-gray-200 rounded-xl bg-[#F8FAFC] space-y-4">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 text-[#94a3b8] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                      </svg>
                      <div>
                        <p className="text-sm font-semibold text-[#0F172A] mb-1">
                          Not enough public information yet
                        </p>
                        <p className="text-sm text-[#475569] leading-relaxed">
                          We weren&apos;t able to find a campaign website, social media presence, or news coverage for this candidate. Our summaries and policy profiles are generated from publicly available sources &mdash; without those, we can&apos;t build a profile automatically.
                        </p>
                      </div>
                    </div>
                    <div className="pl-8 space-y-3">
                      <p className="text-sm text-[#475569]">
                        <span className="font-medium text-[#0F172A]">Are you this candidate?</span>{" "}Submit your campaign website, social media links, or a brief summary and we&apos;ll get your profile updated within 24&nbsp;hours.
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <a
                          href={`/report?page=/candidates/${slug}&type=candidate-info`}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-[#CC0000] text-white text-sm font-medium rounded-lg hover:bg-[#AA0000] transition-colors focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
                        >
                          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                          </svg>
                          Submit links or summary
                        </a>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* Issue tags */}
              {hasIssueTags && (
                <section aria-labelledby="tags-heading">
                  <SectionHeader label={<TrustLabel variant="machine" />}>
                    Issue areas
                  </SectionHeader>
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
                </section>
              )}

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
              {hasSocialLinks && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-[#F8FAFC] border-b border-gray-200">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
                      Campaign presence
                    </h2>
                    <TrustLabel variant="candidate" />
                  </div>
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
                          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="#1877F2" aria-hidden="true">
                            <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
                          </svg>
                          Facebook page
                        </ExternalLink>
                      </li>
                    )}
                    {hasTwitter && (
                      <li className="px-4 py-3">
                        <ExternalLink href={twitterUrl(candidate.twitter_handle!)}>
                          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                          </svg>
                          X / Twitter
                        </ExternalLink>
                      </li>
                    )}
                    {hasLinkedIn && (
                      <li className="px-4 py-3">
                        <ExternalLink href={candidate.linkedin_url!}>
                          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="#0A66C2" aria-hidden="true">
                            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                          </svg>
                          LinkedIn
                        </ExternalLink>
                      </li>
                    )}
                    {hasInstagram && (
                      <li className="px-4 py-3">
                        <ExternalLink href={(candidate as any).instagram_url}>
                          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="url(#ig-gradient)" aria-hidden="true">
                            <defs>
                              <linearGradient id="ig-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#F58529"/>
                                <stop offset="50%" stopColor="#DD2A7B"/>
                                <stop offset="100%" stopColor="#8134AF"/>
                              </linearGradient>
                            </defs>
                            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                          </svg>
                          Instagram
                        </ExternalLink>
                      </li>
                    )}
                    {hasThreads && (
                      <li className="px-4 py-3">
                        <ExternalLink href={(candidate as any).threads_url}>
                          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.028-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.689-2.046 1.429-1.522 1.928-3.924 1.428-7.226-.152-1.016-.456-1.885-.9-2.595-.638-1.019-1.565-1.636-2.76-1.846-.195 1.61-.716 2.895-1.549 3.82-.965 1.073-2.291 1.635-3.947 1.672-1.377.031-2.598-.327-3.44-1.012-.902-.733-1.38-1.812-1.352-3.039.025-1.139.49-2.115 1.348-2.826.898-.742 2.162-1.138 3.658-1.147h.086c1.068.006 2.065.258 2.963.75.09-.498.132-1.01.124-1.53-.014-.884-.215-1.666-.603-2.33C12.91 5.2 12.097 4.8 10.97 4.773c-1.174.023-2.058.472-2.697 1.37-.513.72-.799 1.72-.852 2.97l-2.05-.09c.072-1.7.494-3.118 1.254-4.215C7.61 3.174 9.153 2.42 11.034 2.38c1.87.04 3.346.82 4.386 2.316.792 1.135 1.175 2.598 1.14 4.35a10.5 10.5 0 01-.17 1.844c.803.338 1.51.836 2.103 1.485 1.053 1.148 1.7 2.7 1.922 4.604.6 4.213-.16 7.37-2.255 9.381C16.85 23.205 14.81 23.98 12.186 24zM9.5 13.55c-.572.013-1.056.178-1.396.479-.327.288-.493.675-.505 1.151-.012.499.173.908.554 1.217.414.335 1.01.51 1.724.495 1.09-.025 1.906-.405 2.424-.993.474-.54.74-1.32.793-2.318a7.28 7.28 0 00-1.677-.04c-.654.039-1.344.009-1.917.009z"/>
                          </svg>
                          Threads
                        </ExternalLink>
                      </li>
                    )}
                  </ul>
                </div>
              )}

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

              {/* Campaign Finance */}
              {finance && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-[#F8FAFC] border-b border-gray-200">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
                      Campaign Finance
                    </h2>
                    <TrustLabel variant="official" />
                  </div>
                  <dl className="divide-y divide-gray-100">
                    <div className="flex items-start gap-2 px-4 py-3">
                      <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Raised</dt>
                      <dd className="text-sm font-semibold text-[#0F172A]">
                        ${finance.total_raised.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </dd>
                    </div>
                    <div className="flex items-start gap-2 px-4 py-3">
                      <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Spent</dt>
                      <dd className="text-sm text-[#0F172A]">
                        ${finance.total_spent.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </dd>
                    </div>
                    <div className="flex items-start gap-2 px-4 py-3">
                      <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Cash on hand</dt>
                      <dd className={`text-sm font-medium ${finance.cash_on_hand >= 0 ? "text-green-700" : "text-red-600"}`}>
                        ${finance.cash_on_hand.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </dd>
                    </div>
                    <div className="flex items-start gap-2 px-4 py-3">
                      <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Donors</dt>
                      <dd className="text-sm text-[#0F172A]">{finance.num_donors.toLocaleString()}</dd>
                    </div>
                  </dl>
                  {/* Funding breakdown bar */}
                  {finance.total_raised > 0 && (
                    <div className="px-4 py-3 border-t border-gray-100">
                      <p className="text-xs text-[#94a3b8] mb-2">Funding breakdown</p>
                      <div className="flex h-2 rounded-full overflow-hidden bg-gray-100">
                        <div
                          className="bg-blue-500"
                          style={{ width: `${Math.round((finance.individual_total / finance.total_raised) * 100)}%` }}
                        />
                        <div
                          className="bg-amber-400"
                          style={{ width: `${Math.round((finance.business_pac_total / finance.total_raised) * 100)}%` }}
                        />
                        <div
                          className="bg-purple-400"
                          style={{ width: `${Math.round((finance.self_total / finance.total_raised) * 100)}%` }}
                        />
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                        <span className="flex items-center gap-1 text-xs text-[#475569]">
                          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                          Individual {Math.round((finance.individual_total / finance.total_raised) * 100)}%
                        </span>
                        <span className="flex items-center gap-1 text-xs text-[#475569]">
                          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                          Org/PAC {Math.round((finance.business_pac_total / finance.total_raised) * 100)}%
                        </span>
                        {finance.self_total > 0 && (
                          <span className="flex items-center gap-1 text-xs text-[#475569]">
                            <span className="w-2 h-2 rounded-full bg-purple-400 inline-block" />
                            Self {Math.round((finance.self_total / finance.total_raised) * 100)}%
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {finance.data_as_of && (
                    <div className="px-4 py-2 border-t border-gray-100">
                      <p className="text-xs text-[#94a3b8]">
                        Data as of {new Date(finance.data_as_of).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}. Source: MD SBE.
                      </p>
                    </div>
                  )}
                </div>
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

          <AdSlot />

        </div>
      </div>

    </main>
  );
}
