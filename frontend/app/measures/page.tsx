import type { Metadata } from "next";
import { createServerClient } from "@/lib/supabase-server";
import PageHeader from "@/components/PageHeader";
import type { BallotMeasure } from "@/lib/types";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Ballot Measures",
  description: "2026 Maryland statewide and local ballot measures. Plain-language summaries for every proposition.",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

export default async function MeasuresPage() {
  const supabase = createServerClient();

  const { data } = await supabase
    .from("ballot_measures")
    .select("id, slug, title, plain_language_summary, election_date, jurisdiction_id")
    .order("election_date", { ascending: true })
    .order("title", { ascending: true });

  const measures = (data ?? []) as Pick<
    BallotMeasure,
    "id" | "slug" | "title" | "plain_language_summary" | "election_date" | "jurisdiction_id"
  >[];

  const statewide = measures.filter((m) => !m.jurisdiction_id);
  const local = measures.filter((m) => !!m.jurisdiction_id);

  return (
    <main aria-labelledby="measures-heading" className="flex-1">
      <PageHeader
        title="Ballot measures"
        subtitle={`${measures.length} measure${measures.length === 1 ? "" : "s"} on the 2026 Maryland ballot`}
        breadcrumbs={[{ label: "Home", href: "/" }]}
        badge="2026 Election Cycle"
      />

      <div className="bg-white flex-1">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">

          {measures.length === 0 && (
            <div className="py-16 text-center border border-gray-200 rounded-xl bg-[#F8FAFC]">
              <p className="text-sm font-medium text-[#0F172A] mb-1">No ballot measures on file yet</p>
              <p className="text-xs text-[#94a3b8]">Measures will appear here as they are certified for the 2026 ballot.</p>
            </div>
          )}

          {statewide.length > 0 && (
            <section aria-labelledby="statewide-heading">
              <h2 id="statewide-heading" className="text-base font-semibold text-[#0F172A] mb-4">
                Statewide measures
              </h2>
              <ul className="space-y-3" role="list">
                {statewide.map((m) => (
                  <li key={m.id}>
                    <a
                      href={`/measures/${m.slug}`}
                      className="block p-5 border border-gray-200 rounded-xl hover:border-[#CC0000] hover:bg-[#FFF5F5] transition-all group focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#0F172A] group-hover:text-[#CC0000] transition-colors leading-snug mb-1">
                            {m.title}
                          </p>
                          {m.plain_language_summary && (
                            <p className="text-xs text-[#475569] leading-relaxed line-clamp-2">
                              {m.plain_language_summary}
                            </p>
                          )}
                          <p className="text-xs text-[#94a3b8] mt-2">
                            General Election · {formatDate(m.election_date)}
                          </p>
                        </div>
                        <svg className="w-4 h-4 text-gray-300 group-hover:text-[#CC0000] transition-colors shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {local.length > 0 && (
            <section aria-labelledby="local-heading">
              <h2 id="local-heading" className="text-base font-semibold text-[#0F172A] mb-4">
                Local measures
              </h2>
              <ul className="space-y-3" role="list">
                {local.map((m) => (
                  <li key={m.id}>
                    <a
                      href={`/measures/${m.slug}`}
                      className="block p-5 border border-gray-200 rounded-xl hover:border-[#CC0000] hover:bg-[#FFF5F5] transition-all group focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#0F172A] group-hover:text-[#CC0000] transition-colors leading-snug mb-1">
                            {m.title}
                          </p>
                          {m.plain_language_summary && (
                            <p className="text-xs text-[#475569] leading-relaxed line-clamp-2">
                              {m.plain_language_summary}
                            </p>
                          )}
                          <p className="text-xs text-[#94a3b8] mt-2">
                            {formatDate(m.election_date)}
                          </p>
                        </div>
                        <svg className="w-4 h-4 text-gray-300 group-hover:text-[#CC0000] transition-colors shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

        </div>
      </div>
    </main>
  );
}
