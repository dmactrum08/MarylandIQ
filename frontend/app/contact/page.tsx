import type { Metadata } from "next";
import PageHeader from "@/components/PageHeader";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with MarylandIQ.",
};

const CONTACT_OPTIONS = [
  {
    title: "General questions",
    description: "Questions about MarylandIQ, the data, or how it works.",
    email: "support@marylandiq.org",
    href: "mailto:support@marylandiq.org",
  },
  {
    title: "Report an issue",
    description: "Found incorrect or missing information on a candidate or race page.",
    email: null,
    href: "/report",
    linkLabel: "Use the report form →",
  },
  {
    title: "Privacy questions",
    description: "Questions about how we handle your data.",
    email: "support@marylandiq.org",
    href: "mailto:support@marylandiq.org",
  },
  {
    title: "Legal",
    description: "Legal inquiries, takedown requests, or policy questions.",
    email: "support@marylandiq.org",
    href: "mailto:support@marylandiq.org",
  },
];

export default function ContactPage() {
  return (
    <main className="flex-1">
      <PageHeader
        title="Contact"
        subtitle="We're a small team. Email is the best way to reach us."
        breadcrumbs={[{ label: "Home", href: "/" }]}
      />

      <div className="bg-white flex-1">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">

          <div className="grid gap-4">
            {CONTACT_OPTIONS.map((opt) => (
              <a
                key={opt.title}
                href={opt.href}
                className="flex items-start justify-between gap-4 p-5 border border-gray-200 rounded-xl hover:border-[#CC0000] hover:bg-[#FFF5F5] transition-all group focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#0F172A] group-hover:text-[#CC0000] transition-colors">
                    {opt.title}
                  </p>
                  <p className="text-xs text-[#475569] mt-0.5">{opt.description}</p>
                  {opt.email && (
                    <p className="text-xs text-[#94a3b8] mt-1">{opt.email}</p>
                  )}
                  {opt.linkLabel && (
                    <p className="text-xs text-[#CC0000] mt-1">{opt.linkLabel}</p>
                  )}
                </div>
                <svg
                  className="w-4 h-4 text-gray-300 group-hover:text-[#CC0000] transition-colors shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="2.5"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </a>
            ))}
          </div>

          <div className="border-t border-gray-100 pt-6">
            <p className="text-xs text-[#94a3b8] leading-relaxed">
              MarylandIQ is an independent project. Response times may vary.
              For data corrections, the report form is the fastest path to a fix.
            </p>
          </div>

        </div>
      </div>
    </main>
  );
}
