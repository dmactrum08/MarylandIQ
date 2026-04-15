import type { Metadata } from "next";
import { MD_JURISDICTIONS } from "@/lib/types";
import PageHeader from "@/components/PageHeader";

export const metadata: Metadata = {
  title: "Browse by County",
  description:
    "Browse all 24 Maryland county jurisdictions to find candidates, races, and ballot measures for the 2026 election cycle.",
};

export default function CountiesPage() {
  return (
    <main aria-labelledby="counties-heading" className="flex-1">

      <PageHeader
        title="Browse by county"
        subtitle="Select a Maryland county to see all candidates, races, and ballot measures on the 2026 ballot for that jurisdiction."
        breadcrumbs={[{ label: "Home", href: "/" }]}
        badge="2026 Election Cycle"
      />

      {/* ── County grid ── */}
      <div className="bg-white flex-1">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">

        <p className="text-sm text-[#475569] mb-6">
          <span className="font-semibold text-[#0F172A]">24</span> jurisdictions — 23 counties + Baltimore City
        </p>

        <ul
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          role="list"
          aria-label="Maryland counties and jurisdictions"
        >
          {MD_JURISDICTIONS.map(({ name, slug }) => (
            <li key={slug}>
              <a
                href={`/counties/${slug}`}
                className="flex items-center justify-between px-5 py-4 bg-white border border-gray-200 rounded-xl hover:border-[#CC0000] hover:bg-[#FFF5F5] hover:shadow-sm transition-all duration-150 cursor-pointer group focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
              >
                <div className="flex items-center gap-3">
                  {/* Map pin icon */}
                  <div className="w-8 h-8 rounded-lg bg-gray-100 group-hover:bg-[#CC0000]/10 flex items-center justify-center shrink-0 transition-colors duration-150">
                    <svg
                      className="w-4 h-4 text-gray-400 group-hover:text-[#CC0000] transition-colors duration-150"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="2"
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-[#0F172A] group-hover:text-[#CC0000] transition-colors duration-150">
                    {name}
                  </span>
                </div>
                {/* Chevron */}
                <svg
                  className="w-4 h-4 text-gray-300 group-hover:text-[#CC0000] transition-colors duration-150 shrink-0"
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

        {/* Bottom tip */}
        <div className="mt-10 p-4 bg-[#F8FAFC] border border-gray-200 rounded-xl flex items-start gap-3">
          <svg className="w-5 h-5 text-[#475569] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
          </svg>
          <p className="text-sm text-[#475569] leading-relaxed">
            Don&apos;t know your county?{" "}
            <a
              href="/ballot"
              className="font-medium text-[#CC0000] hover:underline focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
            >
              Enter your address
            </a>{" "}
            and we&apos;ll find your precinct and show you every race on your specific ballot.
          </p>
        </div>
      </div>
      </div>

    </main>
  );
}
