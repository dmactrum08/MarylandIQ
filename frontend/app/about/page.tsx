import type { Metadata } from "next";
import PageHeader from "@/components/PageHeader";
import TrustLabel from "@/components/TrustLabel";

export const metadata: Metadata = {
  title: "About",
  description:
    "What MarylandIQ is, where the data comes from, and how we label it.",
};

export default function AboutPage() {
  return (
    <main aria-labelledby="about-heading" className="flex-1">

      <PageHeader
        title="About MarylandIQ"
        subtitle="Independent, nonpartisan voter research for Maryland local elections."
        breadcrumbs={[{ label: "Home", href: "/" }]}
      />

      <div className="bg-white flex-1">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-16">

          {/* ── What it is ── */}
          <section id="what" aria-labelledby="what-heading">
            <h2 id="what-heading" className="text-xl font-bold text-[#0F172A] mb-4">
              What is MarylandIQ?
            </h2>
            <div className="prose-like space-y-4">
              <p className="text-sm text-[#475569] leading-relaxed">
                MarylandIQ is a free, independent voter research tool built for Maryland local
                elections. It covers county-level races including school board, county council, sheriff,
                state&apos;s attorney, register of wills, and more, as well as statewide and
                federal offices on the 2026 ballot.
              </p>
              <p className="text-sm text-[#475569] leading-relaxed">
                MarylandIQ is not affiliated with any political party, government agency, campaign,
                or advocacy organization. It does not sell data. It exists because Maryland voters
                in local races deserve the same quality of research tools that exist for national elections.
              </p>
            </div>
          </section>

          {/* ── The problem ── */}
          <section id="problem" aria-labelledby="problem-heading">
            <h2 id="problem-heading" className="text-xl font-bold text-[#0F172A] mb-4">
              The problem we&apos;re solving
            </h2>
            <div className="space-y-4">
              <p className="text-sm text-[#475569] leading-relaxed">
                Maryland publishes a lot of election data, but it&apos;s scattered across different
                agencies, counties, and formats. None of it is connected or easy for a typical voter
                to navigate.
              </p>
              <p className="text-sm text-[#475569] leading-relaxed">
                A voter researching their county council race might find a partial listing on a
                third-party site, a document from the county board, and a blank campaign website,
                or nothing at all. MarylandIQ pulls it together in one place.
              </p>
            </div>
          </section>

          {/* ── Data sources ── */}
          <section id="data" aria-labelledby="data-heading">
            <h2 id="data-heading" className="text-xl font-bold text-[#0F172A] mb-4">
              Where the data comes from
            </h2>
            <p className="text-sm text-[#475569] leading-relaxed mb-6">
              Every data source is free and publicly available. MarylandIQ does not access
              voter registration files or any restricted government data.
            </p>

            <div className="space-y-3">
              {[
                {
                  source: "Maryland State Board of Elections",
                  what: "Candidate filings, office listings, and campaign finance information.",
                  label: "official" as const,
                },
                {
                  source: "County boards of elections",
                  what: "Local race details and district information for all 24 jurisdictions.",
                  label: "official" as const,
                },
                {
                  source: "Maryland precinct boundary data",
                  what: "Geographic precinct boundaries used to match your address to your ballot.",
                  label: "official" as const,
                },
                {
                  source: "U.S. Census Bureau Geocoder",
                  what: "Converts your address to a location point. No account required, address is not stored.",
                  label: "official" as const,
                },
                {
                  source: "Candidate campaign websites",
                  what: "Platform positions, About content, and issue pages published by the candidate.",
                  label: "candidate" as const,
                },
                {
                  source: "Public social media profiles",
                  what: "Public posts, bios, and about sections from Facebook, X/Twitter, and LinkedIn. No login used, no private data accessed.",
                  label: "inferred" as const,
                },
              ].map(({ source, what, label }) => (
                <div key={source} className="flex gap-4 p-4 border border-gray-200 rounded-xl">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-medium text-[#0F172A]">{source}</span>
                      <TrustLabel variant={label} />
                    </div>
                    <p className="text-xs text-[#475569]">{what}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Trust labels ── */}
          <section id="trust-labels" aria-labelledby="labels-heading">
            <h2 id="labels-heading" className="text-xl font-bold text-[#0F172A] mb-2">
              How we label information
            </h2>
            <p className="text-sm text-[#475569] leading-relaxed mb-6">
              Every section on a candidate page has a small label showing where the information
              came from. Here&apos;s what each one means.
            </p>

            <div className="space-y-4">
              {[
                {
                  variant: "official" as const,
                  title: "Official source",
                  description:
                    "Comes directly from the Maryland State Board of Elections or a county board of elections. This is the most authoritative information on the site.",
                },
                {
                  variant: "candidate" as const,
                  title: "From the candidate",
                  description:
                    "Sourced from the candidate's own campaign website or social media profile. MarylandIQ shows this content as-is without editing or commenting on it.",
                },
                {
                  variant: "inferred" as const,
                  title: "From public social media",
                  description:
                    "Drawn from publicly visible social media profiles. Always linked back to the original post or page so you can verify it yourself.",
                },
                {
                  variant: "machine" as const,
                  title: "Sourced summary",
                  description:
                    "A summary compiled from publicly available source material, with links to that material. Official data always takes precedence. Summaries fill gaps, they don't replace facts.",
                },
              ].map(({ variant, title, description }) => (
                <div key={variant} className="flex items-start gap-4 p-4 border border-gray-200 rounded-xl">
                  <div className="shrink-0 pt-0.5">
                    <TrustLabel variant={variant} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#0F172A] mb-1">{title}</p>
                    <p className="text-xs text-[#475569] leading-relaxed">{description}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 p-4 bg-[#F8FAFC] border border-gray-200 rounded-xl">
              <p className="text-sm text-[#475569] leading-relaxed">
                <span className="font-medium text-[#0F172A]">If we couldn&apos;t find information, the page says so.</span>{" "}
                If a candidate has no public presence beyond their official filing, their page
                will say that clearly. A missing field is useful information too.
              </p>
            </div>
          </section>

          {/* ── What we don't do ── */}
          <section id="what-we-dont-do" aria-labelledby="dont-heading">
            <h2 id="dont-heading" className="text-xl font-bold text-[#0F172A] mb-4">
              What MarylandIQ does not do
            </h2>
            <ul className="space-y-3">
              {[
                "Access voter registration files or any restricted government data.",
                "Store your address. Geocoding is ephemeral. Only the derived precinct ID is held in session.",
                "Generate candidate positions not grounded in something they actually said or published.",
                "Display content in comparison tables that isn't directly linked to evidence.",
                "Endorse, rank, or editorialize about any candidate.",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <svg
                    className="w-4 h-4 text-[#CC0000] shrink-0 mt-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="2.5"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span className="text-sm text-[#475569] leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* ── How to report an error ── */}
          <section id="corrections" aria-labelledby="corrections-heading">
            <h2 id="corrections-heading" className="text-xl font-bold text-[#0F172A] mb-4">
              How to report an error
            </h2>
            <p className="text-sm text-[#475569] leading-relaxed mb-6">
              Every candidate and race page has a &ldquo;Report an issue&rdquo; link. Use it if
              you find incorrect information, an outdated field, a missing candidate, or anything
              that looks wrong. Reports are reviewed and corrections are applied directly.
            </p>
            <a
              href="/report"
              className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-[#CC0000] hover:bg-[#AA0000] rounded-lg transition-colors duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l1.664 9.914M3 3h13.714M3 3L1.5 1.5M16.714 3l1.664 9.914M16.714 3H3M16.714 3l1.5-1.5M8.25 21a.75.75 0 100-1.5.75.75 0 000 1.5zm7.5 0a.75.75 0 100-1.5.75.75 0 000 1.5zM4.664 12.914h11.386" />
              </svg>
              Report an issue
            </a>
          </section>

          {/* ── Divider ── */}
          <hr className="border-gray-200" />

          {/* ── Contact ── */}
          <section id="contact" aria-labelledby="contact-heading">
            <h2 id="contact-heading" className="text-xl font-bold text-[#0F172A] mb-4">
              Contact
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <a
                href="mailto:support@marylandiq.org"
                className="flex items-start gap-3 p-4 border border-gray-200 rounded-xl hover:border-[#CC0000] transition-colors duration-150 group focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
              >
                <svg className="w-5 h-5 text-gray-400 group-hover:text-[#CC0000] shrink-0 mt-0.5 transition-colors duration-150" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-[#0F172A] group-hover:text-[#CC0000] transition-colors duration-150">Privacy questions</p>
                  <p className="text-xs text-[#94a3b8]">support@marylandiq.org</p>
                </div>
              </a>
              <a
                href="mailto:support@marylandiq.org"
                className="flex items-start gap-3 p-4 border border-gray-200 rounded-xl hover:border-[#CC0000] transition-colors duration-150 group focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
              >
                <svg className="w-5 h-5 text-gray-400 group-hover:text-[#CC0000] shrink-0 mt-0.5 transition-colors duration-150" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-[#0F172A] group-hover:text-[#CC0000] transition-colors duration-150">Legal questions</p>
                  <p className="text-xs text-[#94a3b8]">support@marylandiq.org</p>
                </div>
              </a>
            </div>
          </section>

        </div>
      </div>

    </main>
  );
}
