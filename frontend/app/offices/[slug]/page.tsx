import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase-server";
import PageHeader from "@/components/PageHeader";
import TrustLabel from "@/components/TrustLabel";
import { MD_OFFICES } from "@/lib/types";
import type { Contest, Office, Jurisdiction } from "@/lib/types";

// ─── ISR ──────────────────────────────────────────────────────────────────────

export const revalidate = 3600;

// ─── Static params — driven by MD_OFFICES constant ───────────────────────────

export function generateStaticParams() {
  return MD_OFFICES.map(({ slug }) => ({ slug }));
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContestWithJurisdiction extends Contest {
  jurisdiction: Jurisdiction;
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const office = MD_OFFICES.find((o) => o.slug === slug);
  if (!office) return { title: "Office not found" };
  return {
    title: office.name,
    description: `2026 Maryland ${office.name} races across all counties and candidates.`,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function electionLabel(type: string) {
  if (type === "primary") return "2026 Primary";
  if (type === "general") return "2026 General";
  return "2026 Special";
}

function electionBadgeColor(type: string) {
  if (type === "primary") return "bg-purple-100 text-purple-800";
  if (type === "general") return "bg-blue-100 text-blue-800";
  return "bg-amber-100 text-amber-800";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function OfficePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createServerClient();

  // Fetch office row
  const { data: officeData, error: officeError } = await supabase
    .from("offices")
    .select("*")
    .eq("slug", slug)
    .single();

  if (officeError || !officeData) notFound();

  const office = officeData as Office;

  // Fetch all contests for this office with jurisdiction
  const { data: contestsRaw } = await supabase
    .from("contests")
    .select("*, jurisdiction:jurisdictions(*)")
    .eq("office_id", office.id)
    .order("election_date", { ascending: true })
    .order("jurisdiction_id", { ascending: true })
    .order("district_name", { ascending: true, nullsFirst: true });

  const contests = (contestsRaw ?? []).map((c) => ({
    ...c,
    jurisdiction: Array.isArray(c.jurisdiction) ? c.jurisdiction[0] : c.jurisdiction,
  })) as ContestWithJurisdiction[];

  // Fetch active candidate counts for all contests
  const contestIds = contests.map((c) => c.id);
  const { data: candidateCounts } = contestIds.length
    ? await supabase
        .from("candidates")
        .select("contest_id")
        .in("contest_id", contestIds)
        .eq("filing_status", "Active")
    : { data: [] };

  const countMap: Record<string, number> = {};
  for (const row of candidateCounts ?? []) {
    const id = (row as { contest_id: string }).contest_id;
    countMap[id] = (countMap[id] ?? 0) + 1;
  }

  // Group by election type
  const electionGroups = new Map<string, ContestWithJurisdiction[]>();
  for (const c of contests) {
    if (!electionGroups.has(c.election_type)) electionGroups.set(c.election_type, []);
    electionGroups.get(c.election_type)!.push(c);
  }
  const orderedTypes = ["primary", "general", "special"].filter((t) => electionGroups.has(t));

  const totalCandidates = Object.values(countMap).reduce((a, b) => a + b, 0);

  return (
    <main aria-labelledby="office-heading" className="flex-1">

      <PageHeader
        title={office.name}
        subtitle={`${contests.length} races across Maryland · ${totalCandidates} candidates`}
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Offices", href: "/offices" },
        ]}
        badge="2026 Election Cycle"
      />

      <div className="bg-white flex-1">
        <div className="max-w-5xl 2xl:max-w-[1100px] 3xl:max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* ── Main: contest list ── */}
            <div className="lg:col-span-2 space-y-10">

              {/* Office explainer */}
              {office.explainer_text && (
                <section aria-labelledby="explainer-heading">
                  <div className="flex items-center gap-3 mb-3">
                    <h2 id="explainer-heading" className="text-base font-semibold text-[#0F172A]">
                      About this office
                    </h2>
                    <TrustLabel
                      variant={office.explainer_source === "official" ? "official" : "machine"}
                    />
                  </div>
                  <div className="p-5 bg-[#F8FAFC] border border-gray-200 rounded-xl">
                    <p className="text-sm text-[#475569] leading-relaxed">
                      {office.explainer_text}
                    </p>
                  </div>
                </section>
              )}

              {/* Races by election */}
              {contests.length === 0 ? (
                <div className="p-8 bg-[#F8FAFC] border border-gray-200 rounded-xl text-center">
                  <p className="text-sm text-[#94a3b8]">No races on file for this office yet.</p>
                </div>
              ) : (
                orderedTypes.map((electionType) => {
                  const group = electionGroups.get(electionType)!;
                  return (
                    <section key={electionType} aria-labelledby={`election-${electionType}-heading`}>
                      <div className="flex items-center gap-3 mb-4">
                        <h2
                          id={`election-${electionType}-heading`}
                          className="text-base font-semibold text-[#0F172A]"
                        >
                          {electionLabel(electionType)}
                        </h2>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${electionBadgeColor(electionType)}`}>
                          {formatDate(group[0].election_date)}
                        </span>
                      </div>

                      <div className="border border-gray-200 rounded-xl overflow-hidden">
                        <ul role="list" className="divide-y divide-gray-100">
                          {group.map((contest) => {
                            const candidateCount = countMap[contest.id] ?? 0;
                            const isUncontested = candidateCount <= 1;
                            return (
                              <li key={contest.id}>
                                <a
                                  href={`/races/${contest.slug}`}
                                  className="flex items-center justify-between px-4 py-3 hover:bg-[#FFF5F5] transition-colors group focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#CC0000]"
                                >
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-[#0F172A] group-hover:text-[#CC0000] transition-colors">
                                      {contest.jurisdiction?.name ?? "Unknown"}
                                      {contest.district_name && (
                                        <span className="text-[#94a3b8] font-normal">
                                          {" "}· {contest.district_name}
                                        </span>
                                      )}
                                    </p>
                                    <p className="text-xs text-[#94a3b8] mt-0.5">
                                      {candidateCount === 0
                                        ? "No candidates on file"
                                        : candidateCount === 1
                                        ? "1 candidate"
                                        : `${candidateCount} candidates`}
                                      {" · "}
                                      {contest.seats_available === 1
                                        ? "1 seat"
                                        : `${contest.seats_available} seats`}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0 ml-3">
                                    {isUncontested && (
                                      <span className="text-xs text-[#94a3b8]">Uncontested</span>
                                    )}
                                    <svg
                                      className="w-4 h-4 text-gray-300 group-hover:text-[#CC0000] transition-colors"
                                      fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor"
                                      aria-hidden="true"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                                    </svg>
                                  </div>
                                </a>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </section>
                  );
                })
              )}
            </div>

            {/* ── Sidebar ── */}
            <aside className="space-y-6" aria-label="Office details">

              {/* Stats */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-[#F8FAFC] border-b border-gray-200">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
                    At a glance
                  </h2>
                  <TrustLabel variant="official" />
                </div>
                <dl className="divide-y divide-gray-100">
                  <div className="flex items-start gap-2 px-4 py-3">
                    <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Races</dt>
                    <dd className="text-sm font-semibold text-[#0F172A]">{contests.length}</dd>
                  </div>
                  <div className="flex items-start gap-2 px-4 py-3">
                    <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Candidates</dt>
                    <dd className="text-sm font-semibold text-[#0F172A]">{totalCandidates}</dd>
                  </div>
                  {orderedTypes.map((t) => (
                    <div key={t} className="flex items-start gap-2 px-4 py-3">
                      <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5 capitalize">{t}</dt>
                      <dd className="text-sm text-[#0F172A]">
                        {formatDate(electionGroups.get(t)![0].election_date)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* Browse candidates for this office */}
              <a
                href={`/candidates?office=${slug}`}
                className="flex items-center justify-between w-full px-4 py-3 border border-gray-200 rounded-xl hover:border-[#CC0000] hover:bg-[#FFF5F5] transition-all duration-150 group focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
              >
                <div>
                  <p className="text-xs text-[#94a3b8] mb-0.5">All candidates</p>
                  <p className="text-sm font-medium text-[#0F172A] group-hover:text-[#CC0000] transition-colors">
                    Browse {office.name} candidates
                  </p>
                </div>
                <svg className="w-4 h-4 text-gray-300 group-hover:text-[#CC0000] transition-colors shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </a>

              {/* Report issue */}
              <a
                href={`/report?page=/offices/${slug}`}
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
