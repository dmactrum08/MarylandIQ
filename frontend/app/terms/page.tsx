import type { Metadata } from "next";
import PageHeader from "@/components/PageHeader";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms governing your use of MarylandIQ.",
};

const sections = [
  {
    id: "the-service",
    title: "1. The Service",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        MarylandIQ is an informational platform designed to help users research Maryland elections,
        candidates, races, offices, and ballot measures. MarylandIQ may aggregate public information,
        display official election data, and provide summaries or classifications generated with
        automated tools. MarylandIQ is provided for informational purposes only. It is not a
        government website, election authority, legal advisor, or official source of election
        administration.
      </p>
    ),
  },
  {
    id: "no-affiliation",
    title: "2. No Official Government Affiliation",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        MarylandIQ is independent and is not endorsed by, operated by, or affiliated with the
        Maryland State Board of Elections, any county board of elections, or any government agency
        unless explicitly stated. Users should verify critical election information — including
        registration status, polling location, filing status, deadlines, and official ballot content —
        with the appropriate official election authority.
      </p>
    ),
  },
  {
    id: "acceptable-use",
    title: "3. Eligibility and Acceptable Use",
    content: (
      <>
        <p className="text-sm text-[#475569] leading-relaxed mb-3">
          You may use MarylandIQ only in compliance with applicable law and these Terms. You agree not to:
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm text-[#475569]">
          <li>Use the service for unlawful, fraudulent, or misleading purposes</li>
          <li>Interfere with or disrupt the service or its infrastructure</li>
          <li>Attempt to gain unauthorized access to data, systems, or accounts</li>
          <li>Use automated means to scrape or extract site data in a way that harms the service</li>
          <li>Misrepresent MarylandIQ content as official government guidance</li>
          <li>Submit false, abusive, or malicious correction requests or messages</li>
        </ul>
      </>
    ),
  },
  {
    id: "accuracy",
    title: "4. Accuracy and No Warranty of Completeness",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        MarylandIQ aims to present accurate and useful election information, but does not guarantee
        that all information is complete, current, error-free, or suitable for any particular purpose.
        Election information may change because of filing updates, withdrawals, corrections,
        administrative changes, legal rulings, delayed publication by official sources, or source
        data errors. Some content may be generated or assisted by automated systems. You are
        responsible for independently verifying important information before relying on it.
      </p>
    ),
  },
  {
    id: "candidate-content",
    title: "5. Public Information and Candidate Content",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        MarylandIQ may display or process public information relating to elections, candidates,
        offices, and ballot measures. If you believe content about you or another person is
        inaccurate, outdated, misleading, or improperly sourced, you may{" "}
        <a href="/report" className="text-[#CC0000] hover:underline font-medium">
          contact MarylandIQ and request review
        </a>
        . MarylandIQ reserves the right to determine how to evaluate, correct, annotate, or remove
        content, consistent with applicable law and the platform's informational mission.
      </p>
    ),
  },
  {
    id: "ballot-lookup",
    title: "6. Ballot Lookup and Location-Based Features",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        Ballot lookup results are based on data sources, geocoding, precinct mapping, and election
        records available to MarylandIQ at the time of the request. These results are provided for
        convenience and may not reflect the official ballot in all cases. MarylandIQ does not
        guarantee that ballot lookup results are definitive or legally binding. Users should confirm
        final voting details with official election authorities.
      </p>
    ),
  },
  {
    id: "intellectual-property",
    title: "7. Intellectual Property",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        MarylandIQ and its original content, design, branding, software, and site materials are
        protected by applicable intellectual property laws. Public records, official election data,
        and other third-party materials remain subject to their original ownership and legal status.
        You may not reproduce, republish, distribute, or commercially exploit MarylandIQ's original
        site content or software except as permitted by law or with permission.
      </p>
    ),
  },
  {
    id: "third-party",
    title: "8. Third-Party Services and Links",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        MarylandIQ may link to or rely on third-party services, websites, APIs, and data providers.
        MarylandIQ is not responsible for the content, availability, or practices of those third
        parties. Your use of third-party sites or services is governed by their own terms and policies.
      </p>
    ),
  },
  {
    id: "privacy",
    title: "9. Privacy",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        Your use of MarylandIQ is also governed by the{" "}
        <a href="/privacy" className="text-[#CC0000] hover:underline font-medium">
          Privacy Policy
        </a>
        .
      </p>
    ),
  },
  {
    id: "disclaimers",
    title: "10. Disclaimers",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        MARYLANDIQ IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS
        OR IMPLIED, TO THE MAXIMUM EXTENT PERMITTED BY LAW. MARYLANDIQ DISCLAIMS WARRANTIES OF
        MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, ACCURACY, AND
        AVAILABILITY.
      </p>
    ),
  },
  {
    id: "liability",
    title: "11. Limitation of Liability",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, MARYLANDIQ AND ITS OPERATORS SHALL NOT BE LIABLE
        FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF
        OR RELATED TO YOUR USE OF THE SERVICE. TOTAL LIABILITY FOR ANY CLAIM SHALL NOT EXCEED ONE
        HUNDRED U.S. DOLLARS ($100).
      </p>
    ),
  },
  {
    id: "indemnification",
    title: "12. Indemnification",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        You agree to defend, indemnify, and hold harmless MarylandIQ and its operators from claims,
        liabilities, damages, losses, and expenses arising out of your use of the service, your
        violation of these Terms, your violation of applicable law, or content you submit to
        MarylandIQ.
      </p>
    ),
  },
  {
    id: "changes",
    title: "13. Changes to the Service or Terms",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        MarylandIQ may change, suspend, or discontinue any part of the service at any time.
        MarylandIQ may also update these Terms from time to time. Continued use of the service
        after updated Terms are posted constitutes acceptance of the updated Terms.
      </p>
    ),
  },
  {
    id: "governing-law",
    title: "14. Governing Law",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        These Terms are governed by the laws of the State of Maryland, without regard to
        conflict-of-law principles, except to the extent superseded by applicable federal law.
      </p>
    ),
  },
  {
    id: "contact",
    title: "15. Contact",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        Questions about these Terms?{" "}
        <a href="mailto:support@marylandiq.org" className="text-[#CC0000] hover:underline font-medium">
          support@marylandiq.org
        </a>
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <main aria-labelledby="terms-heading" className="flex-1">

      <PageHeader
        title="Terms of Service"
        subtitle="Last updated: April 10, 2026"
        breadcrumbs={[{ label: "Home", href: "/" }]}
      />

      <div className="bg-white flex-1">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">

          {/* Intro */}
          <div className="mb-10 pb-10 border-b border-gray-200">
            <p className="text-base text-[#475569] leading-relaxed mb-4">
              These Terms of Service govern your access to and use of the MarylandIQ website,
              ballot lookup tools, candidate and election information pages, and related services.
            </p>
            <div className="inline-flex items-start gap-2 px-4 py-3 bg-[#FFFBEB] border border-[#F5A623]/30 rounded-lg">
              <svg className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <p className="text-sm text-[#92400E] leading-relaxed">
                By accessing or using MarylandIQ, you agree to these Terms. If you do not agree,
                do not use the service.
              </p>
            </div>
          </div>

          {/* Table of contents */}
          <nav aria-label="Terms sections" className="mb-10">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8] mb-3">
              Contents
            </h2>
            <ol className="space-y-1">
              {sections.map(({ id, title }) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="text-sm text-[#475569] hover:text-[#CC0000] transition-colors duration-150 focus:outline-none focus:underline"
                  >
                    {title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {/* Sections */}
          <div className="space-y-10">
            {sections.map(({ id, title, content }) => (
              <section key={id} id={id} aria-labelledby={`heading-${id}`}>
                <h2
                  id={`heading-${id}`}
                  className="text-base font-semibold text-[#0F172A] mb-3 scroll-mt-20"
                >
                  {title}
                </h2>
                {content}
              </section>
            ))}
          </div>

          {/* Footer note */}
          <div className="mt-12 pt-8 border-t border-gray-200">
            <p className="text-xs text-[#94a3b8] leading-relaxed">
              This document is a working draft for the current MarylandIQ product scope and should
              be reviewed by counsel before public launch.
            </p>
          </div>

        </div>
      </div>

    </main>
  );
}
