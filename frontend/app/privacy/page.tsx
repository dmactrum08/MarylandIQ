import type { Metadata } from "next";
import PageHeader from "@/components/PageHeader";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How MarylandIQ collects, uses, and protects your information.",
};

const sections = [
  {
    id: "information-we-collect",
    title: "1. Information We Collect",
    subsections: [
      {
        title: "Information you provide directly",
        content: (
          <ul className="list-disc list-inside space-y-1 text-sm text-[#475569]">
            <li>Address information you enter for ballot lookup</li>
            <li>Email address and message content if you submit a correction, feedback, or support request</li>
            <li>Any other information you choose to provide through forms or direct communication</li>
          </ul>
        ),
      },
      {
        title: "Information collected automatically",
        content: (
          <ul className="list-disc list-inside space-y-1 text-sm text-[#475569]">
            <li>IP address or approximate location derived from it</li>
            <li>Browser type, device type, operating system, and referring pages</li>
            <li>Pages viewed, links clicked, search actions, and other usage data</li>
            <li>Basic diagnostics and logs needed to operate, secure, and improve the service</li>
          </ul>
        ),
      },
      {
        title: "Public election and candidate information",
        content: (
          <p className="text-sm text-[#475569] leading-relaxed">
            MarylandIQ stores and processes public information about candidates, contests, offices,
            ballot measures, and related election entities. This information may come from official
            government sources, campaign websites, public web pages, and other publicly available materials.
          </p>
        ),
      },
    ],
  },
  {
    id: "how-we-use",
    title: "2. How We Use Information",
    content: (
      <>
        <ul className="list-disc list-inside space-y-1 text-sm text-[#475569] mb-4">
          <li>Provide ballot lookup and voter information tools</li>
          <li>Show candidate, race, office, and ballot measure pages</li>
          <li>Respond to corrections, questions, and support requests</li>
          <li>Improve site quality, accuracy, performance, and reliability</li>
          <li>Detect misuse, abuse, fraud, or security issues</li>
          <li>Maintain internal records about site performance and reliability</li>
        </ul>
        <p className="text-sm text-[#475569] leading-relaxed">
          Automated tools are used to summarize, classify, or organize public-source information.
          They are not intended to make eligibility, credit, employment, housing, or other legally
          significant decisions about users.
        </p>
      </>
    ),
  },
  {
    id: "ballot-lookup",
    title: "3. Ballot Lookup Data",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        When you use ballot lookup, you may enter an address or location-related information.
        MarylandIQ uses that information only to determine the relevant precinct and ballot contests.
        Address information is not retained beyond the session. MarylandIQ does not build or sell
        address-based voter profiles.
      </p>
    ),
  },
  {
    id: "candidate-data",
    title: "4. Candidate and Public-Source Data",
    content: (
      <>
        <p className="text-sm text-[#475569] leading-relaxed mb-3">
          MarylandIQ processes public information about candidates and elections. This may include:
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm text-[#475569] mb-4">
          <li>Official filing information</li>
          <li>Office sought, party, jurisdiction, and election status</li>
          <li>Campaign website links and other public links</li>
          <li>Public statements or descriptions from official or public sources</li>
          <li>Sourced summaries or issue tags derived from public-source material</li>
        </ul>
        <p className="text-sm text-[#475569] leading-relaxed">
          If you believe a page contains inaccurate, outdated, misleading, or improperly sourced
          content, you may{" "}
          <a href="/report" className="text-[#CC0000] hover:underline font-medium">
            report an issue
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "5. Cookies and Analytics",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        MarylandIQ uses cookies for basic site functionality, security, and analytics. MarylandIQ
        also displays ads served by Google AdSense, which may use cookies to show relevant ads based
        on your browsing activity. You can opt out of personalized ads through{" "}
        <a href="https://adssettings.google.com" className="text-[#CC0000] hover:underline font-medium" target="_blank" rel="noopener noreferrer">
          Google's Ad Settings
        </a>
        . MarylandIQ does not sell your data.
      </p>
    ),
  },
  {
    id: "sharing",
    title: "6. How We Share Information",
    content: (
      <>
        <p className="text-sm text-[#475569] leading-relaxed mb-3">
          MarylandIQ does not sell personal information. We may share information only in these limited circumstances:
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm text-[#475569]">
          <li>With infrastructure and hosting providers that operate the site on our behalf</li>
          <li>If required by law, subpoena, or court order</li>
          <li>To investigate fraud, abuse, or security incidents</li>
          <li>In connection with a business transfer or acquisition</li>
        </ul>
      </>
    ),
  },
  {
    id: "retention",
    title: "7. Data Retention",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        MarylandIQ retains information only as long as reasonably necessary to operate the service,
        maintain election records, comply with legal obligations, and resolve disputes. Public
        election records and related public-interest content may be retained for archival purposes.
      </p>
    ),
  },
  {
    id: "security",
    title: "8. Data Security",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        MarylandIQ uses reasonable technical and organizational measures to protect information.
        No method of transmission over the internet is completely secure, and MarylandIQ cannot
        guarantee absolute security.
      </p>
    ),
  },
  {
    id: "your-rights",
    title: "9. Your Choices and Rights",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        You may contact MarylandIQ to request correction of inaccurate information you submitted,
        ask questions about data handling, or request review of allegedly inaccurate content.
        Contact us at{" "}
        <a href="mailto:support@marylandiq.org" className="text-[#CC0000] hover:underline font-medium">
          support@marylandiq.org
        </a>
        .
      </p>
    ),
  },
  {
    id: "children",
    title: "10. Children's Privacy",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        MarylandIQ is not directed to children under 13 and does not knowingly collect personal
        information from children under 13.
      </p>
    ),
  },
  {
    id: "third-party",
    title: "11. Third-Party Links and Services",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        MarylandIQ may link to official government websites, campaign websites, news outlets, and
        other external resources. MarylandIQ is not responsible for the privacy practices of those
        third parties.
      </p>
    ),
  },
  {
    id: "changes",
    title: "12. Changes to This Policy",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        MarylandIQ may update this Privacy Policy from time to time. Material changes will be
        reflected in the updated date at the top of this page.
      </p>
    ),
  },
  {
    id: "contact",
    title: "13. Contact",
    content: (
      <p className="text-sm text-[#475569] leading-relaxed">
        Questions about this Privacy Policy?{" "}
        <a href="mailto:support@marylandiq.org" className="text-[#CC0000] hover:underline font-medium">
          support@marylandiq.org
        </a>
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <main aria-labelledby="privacy-heading" className="flex-1">

      <PageHeader
        title="Privacy Policy"
        subtitle="Last updated: April 10, 2026"
        breadcrumbs={[{ label: "Home", href: "/" }]}
      />

      <div className="bg-white flex-1">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">

          {/* Intro */}
          <p className="text-base text-[#475569] leading-relaxed mb-10 pb-10 border-b border-gray-200">
            This Privacy Policy explains how MarylandIQ collects, uses, stores, and shares information
            when you use the MarylandIQ website, ballot lookup tools, and related services.
            MarylandIQ is a voter information platform focused on Maryland elections. It aggregates
            public election and candidate information, provides ballot lookup and research tools, and
            uses automated systems to summarize or organize public information for voters.
          </p>

          {/* Table of contents */}
          <nav aria-label="Policy sections" className="mb-10">
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
            {sections.map(({ id, title, content, subsections }) => (
              <section key={id} id={id} aria-labelledby={`heading-${id}`}>
                <h2
                  id={`heading-${id}`}
                  className="text-base font-semibold text-[#0F172A] mb-3 scroll-mt-20"
                >
                  {title}
                </h2>
                {subsections ? (
                  <div className="space-y-4">
                    {subsections.map((sub) => (
                      <div key={sub.title}>
                        <h3 className="text-sm font-medium text-[#0F172A] mb-2">{sub.title}</h3>
                        {sub.content}
                      </div>
                    ))}
                  </div>
                ) : (
                  content
                )}
              </section>
            ))}
          </div>

          {/* Footer note */}
          <div className="mt-12 pt-8 border-t border-gray-200">
            <p className="text-xs text-[#94a3b8] leading-relaxed">
              This document is a working policy for the current MarylandIQ product scope and should
              be reviewed by counsel before public launch.
            </p>
          </div>

        </div>
      </div>

    </main>
  );
}
