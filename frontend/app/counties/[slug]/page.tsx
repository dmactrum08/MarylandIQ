import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase-server";
import PageHeader from "@/components/PageHeader";
import TrustLabel from "@/components/TrustLabel";
import AdSlot from "@/components/AdSlot";
import { MD_JURISDICTIONS } from "@/lib/types";
import type { Jurisdiction, Contest, Office } from "@/lib/types";

// ─── ISR ──────────────────────────────────────────────────────────────────────

export const revalidate = 3600;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContestRow extends Contest {
  office: Office;
  candidate_count: number;
}

interface OfficeGroup {
  office_name: string;
  office_slug: string;
  election_type: string;
  election_date: string;
  contests: ContestRow[];
}

// ─── Static params — driven by MD_JURISDICTIONS constant ─────────────────────

export function generateStaticParams() {
  return MD_JURISDICTIONS.map(({ slug }) => ({ slug }));
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const jurisdiction = MD_JURISDICTIONS.find((j) => j.slug === slug);
  if (!jurisdiction) return { title: "County not found" };
  return {
    title: jurisdiction.name,
    description: `2026 election candidates and races for ${jurisdiction.name}, Maryland.`,
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

/** Strip "(At-Large)" / "(At Large)" suffix so at-large contests group with district races. */
function baseOfficeName(name: string): string {
  return name.replace(/\s*\(At-?Large\)\s*$/i, "").trim();
}

function isAtLargeOffice(name: string): boolean {
  return /\(At-?Large\)\s*$/i.test(name);
}

/** Label shown per contest row in the list. */
function contestRowLabel(contest: ContestRow, groupOfficeName: string): string {
  if (contest.district_name) return contest.district_name;
  if (isAtLargeOffice(contest.office?.name ?? "")) return "At-Large";
  return groupOfficeName;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CountyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createServerClient();

  // Fetch jurisdiction
  const { data: jurisdiction, error: jurError } = await supabase
    .from("jurisdictions")
    .select("*")
    .eq("slug", slug)
    .single();

  if (jurError || !jurisdiction) notFound();

  const jur = jurisdiction as Jurisdiction;

  // Fetch all contests for this jurisdiction with office info
  const { data: contestsRaw } = await supabase
    .from("contests")
    .select("*, office:offices(id, name, slug, explainer_text, explainer_source, explainer_generated_at)")
    .eq("jurisdiction_id", jur.id)
    .order("election_date", { ascending: true })
    .order("office_id", { ascending: true })
    .order("district_name", { ascending: true, nullsFirst: true });

  const contestsData = (contestsRaw ?? []) as (Contest & { office: Office | Office[] })[];

  // Fetch statewide contests (Governor, AG, Comptroller + state/federal district races)
  const { data: statewideJur } = await supabase
    .from("jurisdictions")
    .select("id")
    .eq("slug", "maryland-statewide")
    .single();

  const statewideContests: { slug: string; office_name: string; district_name: string | null }[] = [];
  if (statewideJur) {
    const { data: swRaw } = await supabase
      .from("contests")
      .select("slug, office:offices(name), district_name")
      .eq("jurisdiction_id", statewideJur.id)
      .is("district_name", null) // statewide only — no district races in this card
      .order("election_date", { ascending: true });

    for (const row of swRaw ?? []) {
      const office = Array.isArray((row as any).office) ? (row as any).office[0] : (row as any).office;
      statewideContests.push({
        slug: row.slug,
        office_name: office?.name ?? "",
        district_name: row.district_name ?? null,
      });
    }
  }

  // Fetch active candidate counts for all contests in one query
  const contestIds = contestsData.map((c) => c.id);
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

  // Normalise contests
  const contests: ContestRow[] = contestsData.map((c) => ({
    ...c,
    office: Array.isArray(c.office) ? c.office[0] : c.office,
    candidate_count: countMap[c.id] ?? 0,
  }));

  // Group by election_type → office_name
  const electionGroups = new Map<string, Map<string, ContestRow[]>>();
  for (const c of contests) {
    if (!electionGroups.has(c.election_type)) {
      electionGroups.set(c.election_type, new Map());
    }
    const officeKey = baseOfficeName(c.office?.name ?? "Unknown office");
    const officeMap = electionGroups.get(c.election_type)!;
    if (!officeMap.has(officeKey)) officeMap.set(officeKey, []);
    officeMap.get(officeKey)!.push(c);
  }

  // Flatten into OfficeGroup[] ordered: primary first, then general
  const orderedElectionTypes = ["primary", "general", "special"].filter((t) =>
    electionGroups.has(t)
  );

  const groupedByElection: { electionType: string; officeGroups: OfficeGroup[] }[] =
    orderedElectionTypes.map((electionType) => {
      const officeMap = electionGroups.get(electionType)!;
      const officeGroups: OfficeGroup[] = [];
      for (const [officeName, officeContests] of officeMap) {
        // Prefer the non-at-large office slug for the "About this office" link
        const baseContest = officeContests.find(
          (c) => !isAtLargeOffice(c.office?.name ?? "")
        ) ?? officeContests[0];
        officeGroups.push({
          office_name: officeName,
          office_slug: baseContest.office?.slug ?? "",
          election_type: electionType,
          election_date: officeContests[0].election_date,
          contests: officeContests,
        });
      }
      return { electionType, officeGroups };
    });

  const totalContests = contests.length;
  const totalCandidates = Object.values(countMap).reduce((a, b) => a + b, 0);
  const electionDates = [...new Set(contests.map((c) => c.election_date))].sort();

  return (
    <main aria-labelledby="county-heading" className="flex-1">

      <PageHeader
        title={jur.name}
        subtitle={`2026 Election · ${totalContests} races · ${totalCandidates} candidates`}
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Counties", href: "/counties" },
        ]}
        badge="2026 Election Cycle"
      />

      <div className="bg-white flex-1">
        <div className="max-w-5xl 2xl:max-w-[1100px] 3xl:max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* ── Main: race list ── */}
            <div className="lg:col-span-2 space-y-12">
              {groupedByElection.length === 0 ? (
                <div className="p-8 bg-[#F8FAFC] border border-gray-200 rounded-xl text-center">
                  <p className="text-sm text-[#94a3b8]">No contests on file for this county yet.</p>
                </div>
              ) : (
                groupedByElection.map(({ electionType, officeGroups }) => (
                  <section key={electionType} aria-labelledby={`election-${electionType}`}>

                    {/* Election type header */}
                    <div className="flex items-center gap-3 mb-6">
                      <h2
                        id={`election-${electionType}`}
                        className="text-lg font-bold text-[#0F172A]"
                      >
                        {electionLabel(electionType)}
                      </h2>
                      <span className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold ${electionBadgeColor(electionType)}`}>
                        {formatDate(officeGroups[0]?.election_date)}
                      </span>
                    </div>

                    <div className="space-y-4">
                      {officeGroups.map((group) => (
                        <div key={group.office_name} className="border border-gray-200 rounded-xl overflow-hidden">

                          {/* Office header */}
                          <div className="flex items-center justify-between px-4 py-3 bg-[#F8FAFC] border-b border-gray-200">
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-semibold text-[#0F172A]">
                                {group.office_name}
                              </h3>
                              <TrustLabel variant="official" />
                            </div>
                            <a
                              href={`/offices/${group.office_slug}`}
                              className="text-xs text-[#94a3b8] hover:text-[#CC0000] transition-colors focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
                            >
                              About this office →
                            </a>
                          </div>

                          {/* Contest rows */}
                          <ul role="list" className="divide-y divide-gray-100">
                            {group.contests.map((contest) => (
                              <li key={contest.id}>
                                <a
                                  href={`/races/${contest.slug}`}
                                  className="flex items-center justify-between px-4 py-3 hover:bg-[#FFF5F5] transition-colors group focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#CC0000]"
                                >
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-[#0F172A] group-hover:text-[#CC0000] transition-colors">
                                      {contestRowLabel(contest, group.office_name)}
                                    </p>
                                    <p className="text-xs text-[#94a3b8] mt-0.5">
                                      {contest.seats_available === 1
                                        ? "1 seat"
                                        : `${contest.seats_available} seats`}
                                      {" · "}
                                      {contest.candidate_count === 0
                                        ? "No candidates on file"
                                        : contest.candidate_count === 1
                                        ? "1 candidate"
                                        : `${contest.candidate_count} candidates`}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0 ml-3">
                                    {contest.candidate_count === 0 && (
                                      <span className="text-xs text-amber-600 font-medium">Uncontested</span>
                                    )}
                                    {contest.candidate_count === 1 && (
                                      <span className="text-xs text-[#94a3b8]">Uncontested</span>
                                    )}
                                    <svg
                                      className="w-4 h-4 text-gray-300 group-hover:text-[#CC0000] transition-colors"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      strokeWidth="2.5"
                                      stroke="currentColor"
                                      aria-hidden="true"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                                    </svg>
                                  </div>
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </section>
                ))
              )}
            </div>

            {/* ── Sidebar ── */}
            <aside className="space-y-6" aria-label="County details">

              {/* County stats */}
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
                    <dd className="text-sm font-semibold text-[#0F172A]">{totalContests}</dd>
                  </div>
                  <div className="flex items-start gap-2 px-4 py-3">
                    <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Candidates</dt>
                    <dd className="text-sm font-semibold text-[#0F172A]">{totalCandidates}</dd>
                  </div>
                  {electionDates.map((d) => (
                    <div key={d} className="flex items-start gap-2 px-4 py-3">
                      <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">
                        {contests.find((c) => c.election_date === d)?.election_type === "primary"
                          ? "Primary"
                          : "General"}
                      </dt>
                      <dd className="text-sm text-[#0F172A]">{formatDate(d)}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* Statewide races */}
              {statewideContests.length > 0 && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-[#F8FAFC] border-b border-gray-200">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
                      Statewide races
                    </h2>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {statewideContests.map((c) => (
                      <li key={c.slug}>
                        <a
                          href={`/races/${c.slug}`}
                          className="flex items-center justify-between px-4 py-3 hover:bg-[#FFF5F5] transition-colors group focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#CC0000]"
                        >
                          <span className="text-sm text-[#0F172A] group-hover:text-[#CC0000] transition-colors">
                            {c.office_name}
                          </span>
                          <svg className="w-3.5 h-3.5 text-gray-300 group-hover:text-[#CC0000] shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                          </svg>
                        </a>
                      </li>
                    ))}
                  </ul>
                  <div className="px-4 py-3 border-t border-gray-100 space-y-2">
                    <p className="text-xs text-[#94a3b8]">These races appear on every Maryland voter&apos;s ballot.</p>
                    <p className="text-xs text-[#475569]">
                      State Senator, House of Delegates, and U.S. Representative races vary by district.{" "}
                      <a href="/ballot" className="text-[#CC0000] hover:underline font-medium focus:outline-none">
                        Look up your address
                      </a>{" "}
                      to find yours.
                    </p>
                  </div>
                </div>
              )}

              {/* Statewide ballot measures */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-[#F8FAFC] border-b border-gray-200">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
                    Ballot measures
                  </h2>
                </div>
                <div className="px-4 py-4">
                  <p className="text-xs text-[#475569] leading-relaxed mb-2">
                    Statewide ballot measures appear on every Maryland voter&apos;s ballot in the General Election.
                  </p>
                  <a
                    href="/measures"
                    className="inline-flex items-center gap-1 text-sm font-medium text-[#CC0000] hover:underline focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
                  >
                    View all ballot measures
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </a>
                </div>
              </div>

              {/* Official source */}
              {jur.county_board_url && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-[#F8FAFC] border-b border-gray-200">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
                      Official source
                    </h2>
                  </div>
                  <div className="px-4 py-4 space-y-2">
                    <a
                      href={jur.county_board_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-[#CC0000] hover:underline font-medium focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
                    >
                      {jur.name} Board of Elections
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    </a>
                    <p className="text-xs text-[#94a3b8] leading-relaxed">
                      Verify registration status, polling location, and official ballot with the county board.
                    </p>
                  </div>
                </div>
              )}

              {/* Legislative portal */}
              {jur.legislative_portal_url && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-[#F8FAFC] border-b border-gray-200">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
                      Legislative records
                    </h2>
                  </div>
                  <div className="px-4 py-4 space-y-2">
                    <a
                      href={jur.legislative_portal_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-[#CC0000] hover:underline font-medium focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
                    >
                      {jur.name} Council meetings
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    </a>
                    <p className="text-xs text-[#94a3b8] leading-relaxed">
                      Agendas, votes, and video recordings of past council proceedings.
                    </p>
                  </div>
                </div>
              )}

              {/* Ballot lookup CTA */}
              <div className="border border-[#CC0000]/20 rounded-xl overflow-hidden bg-[#FFF5F5]">
                <div className="px-4 py-4">
                  <p className="text-sm font-semibold text-[#0F172A] mb-1">See your personal ballot</p>
                  <p className="text-xs text-[#475569] leading-relaxed mb-3">
                    Enter your address to see exactly which races are on your ballot in {jur.name}.
                  </p>
                  <a
                    href="/ballot"
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#CC0000] hover:bg-[#AA0000] rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
                  >
                    Look up my ballot
                  </a>
                </div>
              </div>

              {/* Report issue */}
              <a
                href={`/report?page=/counties/${slug}`}
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
