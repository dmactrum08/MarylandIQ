import type { Metadata } from "next";
import PageHeader from "@/components/PageHeader";
import DonateForm from "./DonateForm";

export const metadata: Metadata = {
  title: "Support MarylandIQ",
  description:
    "Help keep MarylandIQ free and independent. Your contribution covers server costs and data maintenance.",
};

export default function DonatePage() {
  return (
    <main className="flex-1">
      <PageHeader
        title="Support MarylandIQ"
        subtitle="Keep Maryland voter research free and independent."
        breadcrumbs={[{ label: "Home", href: "/" }]}
      />

      <div className="bg-white flex-1">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">

          {/* Why donate */}
          <div className="space-y-4 text-sm text-[#475569] leading-relaxed">
            <p>
              MarylandIQ is a free, nonpartisan voter research tool built for Maryland local elections.
              There are no ads, no subscriptions, and no data sales. Everything here is funded out of pocket.
            </p>
            <p>
              If you find it useful, a small contribution helps cover server costs, data maintenance,
              and keeps the site running through the 2026 election cycle.
            </p>
            <p className="text-xs text-[#94a3b8]">
              Contributions are not tax-deductible. MarylandIQ is an independent project, not a registered nonprofit.
            </p>
          </div>

          {/* Donate form */}
          <DonateForm />

          {/* What it covers */}
          <div className="border-t border-gray-100 pt-8 space-y-3">
            <h2 className="text-sm font-semibold text-[#0F172A]">What your contribution covers</h2>
            <ul className="space-y-2 text-sm text-[#475569]">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 w-4 h-4 shrink-0 text-[#CC0000]">
                  <svg fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </span>
                Hosting and database costs
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 w-4 h-4 shrink-0 text-[#CC0000]">
                  <svg fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </span>
                Keeping candidate data current through the 2026 cycle
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 w-4 h-4 shrink-0 text-[#CC0000]">
                  <svg fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </span>
                Building new features: ballot lookup, candidate corrections, and more
              </li>
            </ul>
          </div>

        </div>
      </div>
    </main>
  );
}
