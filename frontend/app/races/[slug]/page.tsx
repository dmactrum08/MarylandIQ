import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase-server";
import PageHeader from "@/components/PageHeader";
import TrustLabel from "@/components/TrustLabel";
import AdSlot from "@/components/AdSlot";
import type { Candidate, CandidateEnrichment, Contest, Office, Jurisdiction } from "@/lib/types";

// ─── ISR ──────────────────────────────────────────────────────────────────────

export const revalidate = 3600;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContestFull extends Contest {
  office: Office;
  jurisdiction: Jurisdiction;
}

interface CandidateWithEnrichment extends Candidate {
  candidate_enrichment: CandidateEnrichment | null;
}

// ─── Static params ────────────────────────────────────────────────────────────

export async function generateStaticParams() {
  const supabase = createServerClient();
  const { data } = await supabase.from("contests").select("slug");
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
    .from("contests")
    .select("election_type, district_name, office:offices(name), jurisdiction:jurisdictions(name)")
    .eq("slug", slug)
    .single();

  if (!data) return { title: "Race not found" };

  const office = Array.isArray(data.office) ? data.office[0] : data.office;
  const jurisdiction = Array.isArray(data.jurisdiction) ? data.jurisdiction[0] : data.jurisdiction;
  const district = data.district_name ? ` · ${data.district_name}` : "";
  const electionLabel = data.election_type === "primary" ? "2026 Primary" : "2026 General";

  return {
    title: `${office?.name ?? "Race"}${district} - ${jurisdiction?.name ?? "Maryland"}`,
    description: `${electionLabel} candidates for ${office?.name ?? "this office"}${district} in ${jurisdiction?.name ?? "Maryland"}.`,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function electionLabel(type: string) {
  if (type === "primary") return "2026 Primary";
  if (type === "general") return "2026 General";
  return "2026 Special Election";
}

function electionBadgeColor(type: string) {
  if (type === "primary") return "bg-purple-100 text-purple-800";
  if (type === "general") return "bg-blue-100 text-blue-800";
  return "bg-amber-100 text-amber-800";
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function truncate(text: string, maxLen = 180) {
  if (text.length <= maxLen) return text;
  return text.slice(0, text.lastIndexOf(" ", maxLen)) + "…";
}

// ─── Candidate card ───────────────────────────────────────────────────────────

function CandidateCard({ candidate }: { candidate: CandidateWithEnrichment }) {
  const enrichment = Array.isArray(candidate.candidate_enrichment)
    ? candidate.candidate_enrichment[0]
    : candidate.candidate_enrichment;

  const isWithdrawn = candidate.filing_status !== "Active";
  const hasSummary = !!enrichment?.ai_summary;
  const hasTags = (enrichment?.issue_tags ?? []).length > 0;
  const summaryLabel: "machine" | "inferred" =
    enrichment?.inferred_from_social ? "inferred" : "machine";

  return (
    <li className={`border rounded-xl overflow-hidden transition-all duration-150 ${
      isWithdrawn ? "opacity-60 border-gray-200" : "border-gray-200 hover:border-[#CC0000] hover:shadow-sm"
    }`}>
      <div className="p-5">
        {/* Name row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <a
                href={`/candidates/${candidate.slug}`}
                className="text-base font-semibold text-[#0F172A] hover:text-[#CC0000] transition-colors focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
              >
                {candidate.full_name}
              </a>
              {candidate.is_incumbent && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-700 text-white">
                  Incumbent
                </span>
              )}
              {isWithdrawn && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                  {candidate.filing_status}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {candidate.party && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${partyColor(candidate.party)}`}>
                  {candidate.party}
                </span>
              )}
            </div>
          </div>
          <a
            href={`/candidates/${candidate.slug}`}
            className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[#CC0000] border border-[#CC0000]/30 rounded-lg hover:bg-[#CC0000] hover:text-white transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-1"
            aria-label={`View profile for ${candidate.full_name}`}
          >
            Profile
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </a>
        </div>

        {/* Summary */}
        {hasSummary ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <TrustLabel variant={summaryLabel} />
            </div>
            <p className="text-sm text-[#475569] leading-relaxed">
              {truncate(enrichment!.ai_summary!)}
            </p>
          </div>
        ) : (
          <p className="text-sm text-[#94a3b8] italic">
            No verified public presence found. No campaign website or public profile available.
          </p>
        )}

        {/* Issue tags */}
        {hasTags && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {(enrichment!.issue_tags as string[]).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function RacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createServerClient();

  // Fetch contest + office + jurisdiction
  const { data: contestData, error: contestError } = await supabase
    .from("contests")
    .select(`
      *,
      office:offices(*),
      jurisdiction:jurisdictions(*)
    `)
    .eq("slug", slug)
    .single();

  if (contestError || !contestData) notFound();

  const contest = contestData as ContestFull & {
    office: Office | Office[];
    jurisdiction: Jurisdiction | Jurisdiction[];
  };
  const office = Array.isArray(contest.office) ? contest.office[0] : contest.office;
  const jurisdiction = Array.isArray(contest.jurisdiction)
    ? contest.jurisdiction[0]
    : contest.jurisdiction;

  // Fetch all candidates in this contest
  const { data: candidatesData } = await supabase
    .from("candidates")
    .select(`
      *,
      candidate_enrichment(
        ai_summary,
        issue_tags,
        enrichment_confidence,
        inferred_from_social,
        social_inference_text
      )
    `)
    .eq("contest_id", contest.id)
    .order("filing_status", { ascending: true }) // Active first
    .order("full_name", { ascending: true });

  const candidates = (candidatesData ?? []) as CandidateWithEnrichment[];
  const activeCandidates = candidates.filter((c) => c.filing_status === "Active");
  const withdrawnCandidates = candidates.filter((c) => c.filing_status !== "Active");

  // Group active candidates by party for primary races
  const isPrimary = contest.election_type === "primary";
  const partiesPresent = isPrimary
    ? [...new Set(activeCandidates.map((c) => c.party ?? "Nonpartisan"))].sort()
    : [];
  const isMultiParty = partiesPresent.length > 1;

  const title = [office?.name, contest.district_name].filter(Boolean).join(" · ");

  return (
    <main aria-labelledby="race-heading" className="flex-1">

      <PageHeader
        title={title}
        subtitle={[
          jurisdiction?.name,
          electionLabel(contest.election_type),
          formatDate(contest.election_date),
        ]
          .filter(Boolean)
          .join(" · ")}
        breadcrumbs={[
          { label: "Home", href: "/" },
          ...(jurisdiction
            ? [{ label: jurisdiction.name, href: `/counties/${jurisdiction.slug}` }]
            : []),
        ]}
        badge={electionLabel(contest.election_type)}
      />

      <div className="bg-white flex-1">
        <div className="max-w-5xl 2xl:max-w-[1100px] 3xl:max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* ── Main: candidate list ── */}
            <div className="lg:col-span-2 space-y-8">

              {/* Office explainer */}
              {office?.explainer_text && (
                <section aria-labelledby="office-explainer-heading">
                  <div className="flex items-center gap-3 mb-3">
                    <h2 id="office-explainer-heading" className="text-base font-semibold text-[#0F172A]">
                      About this office
                    </h2>
                    <TrustLabel variant={office.explainer_source === "official" ? "official" : "machine"} />
                  </div>
                  <div className="p-5 bg-[#F8FAFC] border border-gray-200 rounded-xl">
                    <p className="text-sm text-[#475569] leading-relaxed">{office.explainer_text}</p>
                    <a
                      href={`/offices/${office.slug}`}
                      className="inline-flex items-center gap-1 mt-3 text-xs font-medium text-[#CC0000] hover:underline focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
                    >
                      See all {office.name} races statewide
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </a>
                  </div>
                </section>
              )}

              {/* Candidate list */}
              <section aria-labelledby="candidates-heading">
                <h2 id="candidates-heading" className="text-base font-semibold text-[#0F172A] mb-4">
                  {activeCandidates.length === 1
                    ? "1 candidate"
                    : `${activeCandidates.length} candidates`}
                </h2>

                {activeCandidates.length === 0 ? (
                  <div className="p-6 bg-[#F8FAFC] border border-gray-200 rounded-xl text-center">
                    <p className="text-sm text-[#94a3b8]">No active candidates on file for this contest.</p>
                  </div>
                ) : isMultiParty ? (
                  // Group by party for multi-party primaries
                  <div className="space-y-8">
                    {partiesPresent.map((party) => {
                      const partyCandidates = activeCandidates.filter(
                        (c) => (c.party ?? "Nonpartisan") === party
                      );
                      return (
                        <div key={party}>
                          <div className="flex items-center gap-2 mb-3">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold ${partyColor(party)}`}>
                              {party}
                            </span>
                            <span className="text-xs text-[#94a3b8]">
                              {partyCandidates.length === 1
                                ? "1 candidate"
                                : `${partyCandidates.length} candidates`}
                            </span>
                          </div>
                          <ul className="space-y-3" role="list">
                            {partyCandidates.map((c) => (
                              <CandidateCard key={c.id} candidate={c} />
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <ul className="space-y-3" role="list">
                    {activeCandidates.map((c) => (
                      <CandidateCard key={c.id} candidate={c} />
                    ))}
                  </ul>
                )}

                {/* Withdrawn candidates */}
                {withdrawnCandidates.length > 0 && (
                  <details className="mt-6 group">
                    <summary className="flex items-center gap-2 cursor-pointer text-sm text-[#94a3b8] hover:text-[#475569] transition-colors list-none focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded">
                      <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                      {withdrawnCandidates.length === 1
                        ? "1 withdrawn candidate"
                        : `${withdrawnCandidates.length} withdrawn candidates`}
                    </summary>
                    <ul className="mt-3 space-y-3" role="list">
                      {withdrawnCandidates.map((c) => (
                        <CandidateCard key={c.id} candidate={c} />
                      ))}
                    </ul>
                  </details>
                )}
              </section>

            </div>

            {/* ── Sidebar: race details ── */}
            <aside className="space-y-6" aria-label="Race details">

              {/* Race facts */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-[#F8FAFC] border-b border-gray-200">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
                    Race details
                  </h2>
                  <TrustLabel variant="official" />
                </div>
                <dl className="divide-y divide-gray-100">
                  <div className="flex items-start gap-2 px-4 py-3">
                    <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Election</dt>
                    <dd>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${electionBadgeColor(contest.election_type)}`}>
                        {electionLabel(contest.election_type)}
                      </span>
                    </dd>
                  </div>
                  <div className="flex items-start gap-2 px-4 py-3">
                    <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Date</dt>
                    <dd className="text-sm text-[#0F172A]">{formatDate(contest.election_date)}</dd>
                  </div>
                  <div className="flex items-start gap-2 px-4 py-3">
                    <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Seats</dt>
                    <dd className="text-sm text-[#0F172A]">{contest.seats_available}</dd>
                  </div>
                  {contest.district_name && (
                    <div className="flex items-start gap-2 px-4 py-3">
                      <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">District</dt>
                      <dd className="text-sm text-[#0F172A]">{contest.district_name}</dd>
                    </div>
                  )}
                  {jurisdiction && (
                    <div className="flex items-start gap-2 px-4 py-3">
                      <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">County</dt>
                      <dd>
                        <a
                          href={`/counties/${jurisdiction.slug}`}
                          className="text-sm text-[#CC0000] hover:underline focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
                        >
                          {jurisdiction.name}
                        </a>
                      </dd>
                    </div>
                  )}
                  <div className="flex items-start gap-2 px-4 py-3">
                    <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Candidates</dt>
                    <dd className="text-sm text-[#0F172A]">{activeCandidates.length} active</dd>
                  </div>
                </dl>
              </div>

              {/* Official sources */}
              {jurisdiction?.county_board_url && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-[#F8FAFC] border-b border-gray-200">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
                      Official sources
                    </h2>
                  </div>
                  <div className="px-4 py-3">
                    <a
                      href={jurisdiction.county_board_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-[#CC0000] hover:underline font-medium focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
                    >
                      {jurisdiction.name} Board of Elections
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    </a>
                  </div>
                </div>
              )}

              {/* County races link */}
              {jurisdiction && (
                <a
                  href={`/counties/${jurisdiction.slug}`}
                  className="flex items-center justify-between w-full px-4 py-3 border border-gray-200 rounded-xl hover:border-[#CC0000] hover:bg-[#FFF5F5] transition-all duration-150 group focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
                >
                  <div>
                    <p className="text-xs text-[#94a3b8] mb-0.5">All races in</p>
                    <p className="text-sm font-medium text-[#0F172A] group-hover:text-[#CC0000] transition-colors">
                      {jurisdiction.name}
                    </p>
                  </div>
                  <svg className="w-4 h-4 text-gray-300 group-hover:text-[#CC0000] transition-colors shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </a>
              )}

              {/* Report issue */}
              <a
                href={`/report?page=/races/${slug}`}
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
