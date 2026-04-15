import type { Metadata } from "next";
import { MD_JURISDICTIONS, MD_OFFICES } from "@/lib/types";

export const metadata: Metadata = {
  title: "MarylandIQ — Maryland Voter Research for Local Elections",
  description:
    "Free, sourced voter research for Maryland local elections — school board, county council, sheriff, and more. Find any candidate, any county. No account required.",
};

export default function Home() {
  return (
    <main>

      {/* ══════════════════════════════════════════
          HERO
      ══════════════════════════════════════════ */}
      <section aria-labelledby="hero-heading" className="bg-[#0F172A] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 lg:py-24">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">

            {/* Left: Headline + CTAs */}
            <div>
              {/* Cycle badge */}
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold mb-6 border border-[#F5A623]/40 text-[#F5A623] bg-[#F5A623]/10">
                <span className="w-1.5 h-1.5 rounded-full bg-[#F5A623] inline-block" aria-hidden="true" />
                2026 Election Cycle · Primary &amp; General
              </div>

              <h1
                id="hero-heading"
                className="text-4xl sm:text-5xl font-bold leading-tight tracking-tight mb-4"
              >
                Know your ballot.<br />
                <span className="text-[#F5A623]">Know your candidates.</span>
              </h1>

              <p className="text-lg text-slate-300 leading-relaxed mb-8 max-w-lg">
                Free, sourced voter research for Maryland local elections — school board,
                county council, sheriff, and more. Find any candidate, any county.
                No account required.
              </p>

              {/* CTAs */}
              <div className="flex flex-wrap gap-3 mb-6">
                <a
                  href="/ballot"
                  className="inline-flex items-center gap-2 px-6 py-3 text-base font-semibold text-white bg-[#CC0000] hover:bg-[#AA0000] rounded-lg transition-colors duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#0F172A]"
                >
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 19.5l-4.35-4.35" />
                  </svg>
                  Look up my ballot
                </a>
                <a
                  href="/candidates"
                  className="inline-flex items-center gap-2 px-6 py-3 text-base font-semibold text-white border border-white/30 hover:bg-white/10 rounded-lg transition-colors duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#0F172A]"
                >
                  Browse all candidates
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </a>
              </div>

              {/* Trust micro-line */}
              <p className="text-sm text-slate-400 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-[#F5A623] shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 1a.75.75 0 01.671.415l2.293 4.644 5.122.744a.75.75 0 01.416 1.279l-3.708 3.613.876 5.102a.75.75 0 01-1.088.791L10 15.347l-4.583 2.41a.75.75 0 01-1.088-.791l.875-5.102L1.498 8.082a.75.75 0 01.416-1.279l5.122-.744L9.33 1.415A.75.75 0 0110 1z" clipRule="evenodd" />
                </svg>
                Sourced from the Maryland State Board of Elections · Every field labeled
              </p>
            </div>

            {/* Right: Ballot lookup card */}
            <div className="lg:justify-self-end w-full max-w-md">
              <div className="bg-white rounded-2xl shadow-2xl p-6 sm:p-8">
                <div className="flex items-center gap-2 mb-1">
                  <svg className="w-5 h-5 text-[#CC0000] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                  <h2 className="text-base font-semibold text-[#0F172A]">Find your ballot</h2>
                </div>
                <p className="text-sm text-[#64748b] mb-4 ml-7">
                  Enter your Maryland address to see every race on your ballot.
                </p>

                <form action="/ballot" method="GET" role="search" aria-label="Ballot lookup by address">
                  <label htmlFor="address-input" className="block text-sm font-medium text-[#0F172A] mb-1.5">
                    Your Maryland address
                  </label>
                  <input
                    id="address-input"
                    type="text"
                    name="address"
                    autoComplete="street-address"
                    placeholder="123 Main St, Rockville, MD"
                    required
                    aria-required="true"
                    className="w-full px-4 py-3 text-sm text-[#0F172A] border border-gray-300 rounded-lg placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:border-transparent transition-colors duration-150"
                  />
                  <button
                    type="submit"
                    className="mt-3 w-full py-3 px-4 text-sm font-semibold text-white bg-[#CC0000] hover:bg-[#AA0000] rounded-lg transition-colors duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
                  >
                    Show my ballot
                  </button>
                </form>

                <div className="mt-4 pt-4 border-t border-gray-100 flex items-start gap-2">
                  <svg className="w-4 h-4 text-[#64748b] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                  <p className="text-xs text-[#64748b] leading-relaxed">
                    Your address is never stored. We use it only to determine your voting precinct for this session.
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          CANDIDATE SEARCH
      ══════════════════════════════════════════ */}
      <section aria-labelledby="search-heading" className="bg-[#F8FAFC] border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="max-w-2xl mx-auto text-center">
            <h2 id="search-heading" className="text-2xl font-bold text-[#0F172A] mb-2">
              Search for any candidate
            </h2>
            <p className="text-[#475569] mb-6">
              Look up by name, office, or county across all 2026 Maryland candidates.
            </p>

            <form
              action="/candidates"
              method="GET"
              role="search"
              aria-label="Candidate search"
              className="flex gap-2"
            >
              <label htmlFor="candidate-search" className="sr-only">
                Search candidates by name, office, or county
              </label>
              <input
                id="candidate-search"
                type="search"
                name="q"
                placeholder="e.g. Jane Smith, Prince George's County Sheriff..."
                className="flex-1 px-4 py-3 text-sm text-[#0F172A] border border-gray-300 rounded-lg bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:border-transparent transition-colors duration-150"
                aria-describedby="search-hint"
              />
              <button
                type="submit"
                className="shrink-0 inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-[#0F172A] hover:bg-[#334155] rounded-lg transition-colors duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0F172A] focus:ring-offset-2"
                aria-label="Search candidates"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                <span className="hidden sm:inline">Search</span>
              </button>
            </form>
            <p id="search-hint" className="mt-3 text-xs text-[#64748b]">
              Searching all 24 Maryland counties · 2026 primary &amp; general candidates
            </p>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          BROWSE BY COUNTY
      ══════════════════════════════════════════ */}
      <section aria-labelledby="county-heading" className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <div className="mb-8">
            <h2 id="county-heading" className="text-2xl font-bold text-[#0F172A] mb-1">
              Browse by county
            </h2>
            <p className="text-[#475569]">
              Select your county to see all candidates, races, and ballot measures.
            </p>
          </div>

          <ul
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
            role="list"
            aria-label="Maryland counties"
          >
            {MD_JURISDICTIONS.map(({ name, slug }) => (
              <li key={slug}>
                <a
                  href={`/counties/${slug}`}
                  className="flex items-center justify-between px-4 py-3.5 text-sm font-medium text-[#0F172A] bg-white border border-gray-200 rounded-lg hover:border-[#CC0000] hover:bg-[#FFF5F5] hover:text-[#CC0000] transition-all duration-150 cursor-pointer group focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-1"
                >
                  <span>{name}</span>
                  <svg
                    className="w-3.5 h-3.5 text-gray-400 group-hover:text-[#CC0000] transition-colors duration-150 shrink-0 ml-1"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="2.5"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          BROWSE BY OFFICE
      ══════════════════════════════════════════ */}
      <section aria-labelledby="office-heading" className="bg-[#F8FAFC] border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h2 id="office-heading" className="text-2xl font-bold text-[#0F172A] mb-1">
                Browse by office type
              </h2>
              <p className="text-[#475569]">
                Federal, statewide, state legislative, and county offices — all on the 2026 ballot.
              </p>
            </div>
            <a
              href="/offices"
              className="shrink-0 text-sm font-medium text-[#CC0000] hover:underline focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:rounded mt-1"
            >
              See all {MD_OFFICES.length} →
            </a>
          </div>

          <ul className="flex flex-wrap gap-2.5" role="list" aria-label="Featured office types">
            {MD_OFFICES.slice(0, 9).map(({ name, slug }) => (
              <li key={slug}>
                <a
                  href={`/offices/${slug}`}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-[#0F172A] bg-white border border-gray-300 rounded-full hover:bg-[#0F172A] hover:text-white hover:border-[#0F172A] transition-all duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-1 min-h-[44px]"
                >
                  {name}
                </a>
              </li>
            ))}
            <li>
              <a
                href="/offices"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-[#CC0000] bg-white border border-[#CC0000]/30 rounded-full hover:bg-[#CC0000] hover:text-white hover:border-[#CC0000] transition-all duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-1 min-h-[44px]"
              >
                +{MD_OFFICES.length - 9} more →
              </a>
            </li>
          </ul>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          HOW IT WORKS
      ══════════════════════════════════════════ */}
      <section aria-labelledby="how-heading" className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="text-center mb-12">
            <h2 id="how-heading" className="text-2xl font-bold text-[#0F172A] mb-2">
              How MarylandIQ works
            </h2>
            <p className="text-[#475569] max-w-xl mx-auto">
              Research any candidate or race on your 2026 Maryland ballot — local offices, county races, and more.
            </p>
          </div>

          <ol className="grid sm:grid-cols-3 gap-8 lg:gap-12">
            {[
              {
                n: "1",
                title: "Find your information",
                body: "Enter your address for a personalized ballot, search by candidate name, or browse by county or office type. All paths lead to the same sourced profiles.",
              },
              {
                n: "2",
                title: "Read sourced profiles",
                body: "Every candidate page brings together official filing records, campaign information, and a sourced summary. Every candidate gets a complete page — not a blank.",
              },
              {
                n: "3",
                title: "Know where it came from",
                body: "Every piece of information is labeled with its source. If we couldn't find information about a candidate, the page says so directly — nothing is hidden.",
              },
            ].map(({ n, title, body }) => (
              <li key={n} className="flex flex-col items-center text-center sm:items-start sm:text-left">
                <div
                  className="w-12 h-12 rounded-xl bg-[#CC0000] text-white flex items-center justify-center text-xl font-bold mb-4 shrink-0"
                  aria-hidden="true"
                >
                  {n}
                </div>
                <h3 className="text-base font-semibold text-[#0F172A] mb-2">{title}</h3>
                <p className="text-sm text-[#475569] leading-relaxed">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          TRUST STRIP
      ══════════════════════════════════════════ */}
      <section aria-labelledby="trust-heading" className="bg-[#FFFBEB] border-b border-[#F5A623]/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
            <div className="shrink-0 w-12 h-12 rounded-xl bg-[#F5A623]/20 flex items-center justify-center" aria-hidden="true">
              <svg className="w-6 h-6 text-[#B45309]" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </div>
            <div>
              <h2 id="trust-heading" className="text-base font-semibold text-[#78350F] mb-1">
                Independent, nonpartisan, and free.
              </h2>
              <p className="text-sm text-[#92400E] leading-relaxed max-w-2xl">
                MarylandIQ is not affiliated with any political party, government agency, or campaign.
                We do not store your address. We do not sell data.
                Every inference is labeled. Official data always takes precedence over AI output.
              </p>
            </div>
            <div className="shrink-0 sm:ml-auto flex flex-col sm:items-end gap-3">
              <a
                href="/about"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#92400E] hover:text-[#78350F] underline underline-offset-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#F5A623] focus:ring-offset-2 focus:rounded"
              >
                About our data sources
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </a>
              <a
                href="/donate"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#92400E] hover:text-[#78350F] border border-[#F5A623]/40 hover:border-[#F5A623] rounded-lg px-3 py-1.5 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#F5A623] focus:ring-offset-2"
              >
                Support this project
              </a>
            </div>
          </div>
        </div>
      </section>

    </main>
  );
}
