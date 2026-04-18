import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase-server";
import PageHeader from "@/components/PageHeader";
import TrustLabel from "@/components/TrustLabel";
import type { BallotMeasure, Jurisdiction } from "@/lib/types";

// ─── ISR ──────────────────────────────────────────────────────────────────────

export const revalidate = 3600;

// ─── Types ────────────────────────────────────────────────────────────────────

interface BallotMeasureFull extends BallotMeasure {
  jurisdiction: Jurisdiction | null;
}

// ─── Static params ────────────────────────────────────────────────────────────

export async function generateStaticParams() {
  const supabase = createServerClient();
  const { data } = await supabase.from("ballot_measures").select("slug");
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
    .from("ballot_measures")
    .select("title, plain_language_summary")
    .eq("slug", slug)
    .single();

  if (!data) return { title: "Ballot measure not found" };

  return {
    title: data.title,
    description: data.plain_language_summary
      ? data.plain_language_summary.slice(0, 160)
      : `2026 Maryland ballot measure: ${data.title}`,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function MeasurePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("ballot_measures")
    .select("*, jurisdiction:jurisdictions(*)")
    .eq("slug", slug)
    .single();

  if (error || !data) notFound();

  const measure = {
    ...data,
    jurisdiction: Array.isArray(data.jurisdiction)
      ? data.jurisdiction[0] ?? null
      : data.jurisdiction ?? null,
  } as BallotMeasureFull;

  const scope = measure.jurisdiction ? measure.jurisdiction.name : "Statewide";
  const scopeSlug = measure.jurisdiction?.slug ?? null;

  return (
    <main aria-labelledby="measure-heading" className="flex-1">

      <PageHeader
        title={measure.title}
        subtitle={[
          scope,
          "Ballot Measure",
          formatDate(measure.election_date),
        ].join(" · ")}
        breadcrumbs={[
          { label: "Home", href: "/" },
          ...(scopeSlug
            ? [{ label: scope, href: `/counties/${scopeSlug}` }]
            : []),
        ]}
        badge="2026 General Election"
      />

      <div className="bg-white flex-1">
        <div className="max-w-5xl 2xl:max-w-[1100px] 3xl:max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* ── Main content ── */}
            <div className="lg:col-span-2 space-y-10">

              {/* Plain-language summary */}
              <section aria-labelledby="summary-heading">
                <div className="flex items-center gap-3 mb-4">
                  <h2 id="summary-heading" className="text-base font-semibold text-[#0F172A]">
                    Plain-language summary
                  </h2>
                  <TrustLabel variant="machine" />
                </div>
                {measure.plain_language_summary ? (
                  <div className="p-5 bg-[#F8FAFC] border border-gray-200 rounded-xl">
                    <p className="text-sm text-[#0F172A] leading-relaxed">
                      {measure.plain_language_summary}
                    </p>
                    {measure.summary_generated_at && (
                      <p className="text-xs text-[#94a3b8] mt-3">
                        Summary generated{" "}
                        {new Date(measure.summary_generated_at).toLocaleDateString("en-US", {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="p-5 bg-[#F8FAFC] border border-gray-200 rounded-xl">
                    <p className="text-sm text-[#94a3b8] italic">
                      No plain-language summary available yet.
                    </p>
                  </div>
                )}
              </section>

              {/* Official text */}
              <section aria-labelledby="official-text-heading">
                <div className="flex items-center gap-3 mb-4">
                  <h2 id="official-text-heading" className="text-base font-semibold text-[#0F172A]">
                    Official text
                  </h2>
                  <TrustLabel variant="official" />
                </div>
                {measure.official_text ? (
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    {/* Collapsible — official text can be very long */}
                    <details className="group">
                      <summary className="flex items-center justify-between px-5 py-4 cursor-pointer bg-[#F8FAFC] hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#CC0000] list-none">
                        <span className="text-sm font-medium text-[#0F172A]">
                          View full official text
                        </span>
                        <svg
                          className="w-4 h-4 text-[#94a3b8] transition-transform group-open:rotate-180 shrink-0"
                          fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"
                          aria-hidden="true"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </summary>
                      <div className="px-5 py-4 border-t border-gray-200">
                        <p className="text-sm text-[#475569] leading-relaxed whitespace-pre-wrap">
                          {measure.official_text}
                        </p>
                      </div>
                    </details>
                  </div>
                ) : (
                  <div className="p-5 bg-[#F8FAFC] border border-gray-200 rounded-xl">
                    <p className="text-sm text-[#94a3b8] italic">
                      Official text not yet available.
                    </p>
                  </div>
                )}
              </section>

            </div>

            {/* ── Sidebar ── */}
            <aside className="space-y-6" aria-label="Measure details">

              {/* Measure facts */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-[#F8FAFC] border-b border-gray-200">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
                    Measure details
                  </h2>
                  <TrustLabel variant="official" />
                </div>
                <dl className="divide-y divide-gray-100">
                  <div className="flex items-start gap-2 px-4 py-3">
                    <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Election</dt>
                    <dd>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                        2026 General
                      </span>
                    </dd>
                  </div>
                  <div className="flex items-start gap-2 px-4 py-3">
                    <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Date</dt>
                    <dd className="text-sm text-[#0F172A]">{formatDate(measure.election_date)}</dd>
                  </div>
                  <div className="flex items-start gap-2 px-4 py-3">
                    <dt className="text-xs text-[#94a3b8] w-24 shrink-0 mt-0.5">Scope</dt>
                    <dd className="text-sm text-[#0F172A]">
                      {scopeSlug ? (
                        <a
                          href={`/counties/${scopeSlug}`}
                          className="text-[#CC0000] hover:underline focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
                        >
                          {scope}
                        </a>
                      ) : (
                        scope
                      )}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Source link */}
              {measure.source_url && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-[#F8FAFC] border-b border-gray-200">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
                      Source
                    </h2>
                  </div>
                  <div className="px-4 py-4">
                    <a
                      href={measure.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-[#CC0000] hover:underline font-medium focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
                    >
                      View source
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    </a>
                  </div>
                </div>
              )}

              {/* Trust note */}
              <div className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-xl">
                <p className="text-xs text-[#475569] leading-relaxed">
                  <span className="font-semibold text-[#0F172A]">Plain-language summaries</span> are
                  compiled from official source text. Always review the official text and
                  verify with official election authorities before voting.
                </p>
              </div>

              {/* Report issue */}
              <a
                href={`/report?page=/measures/${slug}`}
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
