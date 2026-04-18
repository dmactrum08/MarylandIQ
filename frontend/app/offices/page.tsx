import type { Metadata } from "next";
import PageHeader from "@/components/PageHeader";

export const metadata: Metadata = {
  title: "Browse by Office Type",
  description:
    "Explore Maryland 2026 candidates by office type: federal, statewide, state legislative, and county offices.",
};

type OfficeLevel = "Federal" | "Statewide" | "State Legislative" | "County";

interface OfficeEntry {
  name: string;
  slug: string;
  description: string;
  scope: string;
  level: OfficeLevel;
}

const offices: OfficeEntry[] = [
  // ── Federal ──────────────────────────────────────────────────────────────
  {
    name: "U.S. Senator",
    slug: "us-senator",
    description:
      "One of Maryland's two representatives in the U.S. Senate. Serves a 6-year term. Votes on federal legislation, treaties, and presidential nominations.",
    scope: "Statewide",
    level: "Federal",
  },
  {
    name: "U.S. Representative",
    slug: "us-representative",
    description:
      "Represents one of Maryland's 8 congressional districts in the U.S. House of Representatives. Serves a 2-year term.",
    scope: "Congressional district",
    level: "Federal",
  },

  // ── Statewide ─────────────────────────────────────────────────────────────
  {
    name: "Governor",
    slug: "governor",
    description:
      "Maryland's chief executive. Manages state agencies, signs or vetoes legislation, and sets the state budget. Serves a 4-year term.",
    scope: "Statewide",
    level: "Statewide",
  },
  {
    name: "Attorney General",
    slug: "attorney-general",
    description:
      "Maryland's chief legal officer. Represents the state in court, enforces consumer protection and civil rights laws, and issues legal opinions.",
    scope: "Statewide",
    level: "Statewide",
  },
  {
    name: "Comptroller",
    slug: "comptroller",
    description:
      "Oversees state finances, collects taxes, and manages payroll for state employees. One of three elected members of the Board of Public Works.",
    scope: "Statewide",
    level: "Statewide",
  },

  // ── State Legislative ─────────────────────────────────────────────────────
  {
    name: "State Senator",
    slug: "state-senator",
    description:
      "Member of the Maryland Senate. One of 47 senators representing legislative districts. Votes on state laws, the state budget, and confirms appointments.",
    scope: "Legislative district",
    level: "State Legislative",
  },
  {
    name: "House of Delegates Member",
    slug: "house-of-delegates",
    description:
      "Member of the Maryland House of Delegates. 141 delegates serve multi-member districts. The larger chamber of the General Assembly.",
    scope: "Legislative district",
    level: "State Legislative",
  },

  // ── County ────────────────────────────────────────────────────────────────
  {
    name: "County Executive",
    slug: "county-executive",
    description:
      "The chief executive of a Maryland county government, responsible for managing county operations, the budget, and executive branch departments.",
    scope: "County-wide",
    level: "County",
  },
  {
    name: "County Council Member",
    slug: "county-council-member",
    description:
      "Elected members of the county legislative body. Responsible for enacting local laws, approving the budget, and overseeing county government.",
    scope: "District or at-large",
    level: "County",
  },
  {
    name: "Board of Education Member",
    slug: "board-of-education-member",
    description:
      "Governs the local public school system. Sets policy, approves the school budget, and oversees the superintendent.",
    scope: "District or at-large",
    level: "County",
  },
  {
    name: "Sheriff",
    slug: "sheriff",
    description:
      "The chief law enforcement officer of a Maryland county. Manages the county jail, court security, and may handle civil process and patrol.",
    scope: "County-wide",
    level: "County",
  },
  {
    name: "State's Attorney",
    slug: "states-attorney",
    description:
      "The chief prosecutor for a Maryland county. Decides which criminal cases to pursue and represents the state in circuit court proceedings.",
    scope: "County-wide",
    level: "County",
  },
  {
    name: "Circuit Court Judge",
    slug: "circuit-court-judge",
    description:
      "Elected judges serving Maryland's circuit courts, the trial courts of general jurisdiction. Handle civil, criminal, family, and juvenile cases.",
    scope: "Circuit (multi-county)",
    level: "County",
  },
  {
    name: "Register of Wills",
    slug: "register-of-wills",
    description:
      "Administers the probate process for estates, oversees guardianships and trusts, and maintains probate court records for the county.",
    scope: "County-wide",
    level: "County",
  },
  {
    name: "Clerk of the Circuit Court",
    slug: "clerk-of-circuit-court",
    description:
      "Maintains court records, processes filings, and manages administrative functions for the county's circuit court.",
    scope: "County-wide",
    level: "County",
  },
  {
    name: "Orphans' Court Judge",
    slug: "orphans-court-judge",
    description:
      "Judges on Maryland's probate court. Oversee estates, guardianships, and the administration of decedents' affairs.",
    scope: "County-wide",
    level: "County",
  },
];

const LEVELS: { level: OfficeLevel; description: string; color: string; bg: string }[] = [
  {
    level: "Federal",
    description: "Representing Maryland in the U.S. Congress",
    color: "text-blue-800",
    bg: "bg-blue-50 border-blue-200",
  },
  {
    level: "Statewide",
    description: "Elected by all Maryland voters",
    color: "text-purple-800",
    bg: "bg-purple-50 border-purple-200",
  },
  {
    level: "State Legislative",
    description: "Maryland General Assembly: Senate and House of Delegates",
    color: "text-green-800",
    bg: "bg-green-50 border-green-200",
  },
  {
    level: "County",
    description: "Local government offices across all 24 jurisdictions",
    color: "text-[#92400E]",
    bg: "bg-[#FFFBEB] border-[#F5A623]/30",
  },
];

const levelBadge: Record<OfficeLevel, string> = {
  Federal: "bg-blue-100 text-blue-800",
  Statewide: "bg-purple-100 text-purple-800",
  "State Legislative": "bg-green-100 text-green-800",
  County: "bg-amber-100 text-amber-800",
};

export default function OfficesPage() {
  const grouped = LEVELS.map(({ level, description, color, bg }) => ({
    level,
    description,
    color,
    bg,
    offices: offices.filter((o) => o.level === level),
  }));

  return (
    <main aria-labelledby="offices-heading" className="flex-1">

      <PageHeader
        title="Browse by office type"
        subtitle="All offices on the 2026 Maryland ballot: federal, statewide, state legislative, and county."
        breadcrumbs={[{ label: "Home", href: "/" }]}
        badge="2026 Election Cycle"
      />

      <div className="bg-white flex-1">
        <div className="max-w-7xl 2xl:max-w-[1400px] 3xl:max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-12">

          <p className="text-sm text-[#475569] mb-10">
            <span className="font-semibold text-[#0F172A]">{offices.length}</span> office types across federal, state, and county levels
          </p>

          {/* Grouped sections */}
          <div className="space-y-12">
            {grouped.map(({ level, description, color, bg, offices: group }) => (
              <section key={level} aria-labelledby={`level-${level}`}>

                {/* Level header */}
                <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border mb-4 ${bg}`}>
                  <div>
                    <h2 id={`level-${level}`} className={`text-sm font-semibold ${color}`}>
                      {level}
                    </h2>
                    <p className={`text-xs ${color} opacity-80`}>{description}</p>
                  </div>
                </div>

                {/* Office cards */}
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="list">
                  {group.map(({ name, slug, description: desc, scope }) => (
                    <li key={slug}>
                      <a
                        href={`/offices/${slug}`}
                        className="flex items-start gap-4 p-5 bg-white border border-gray-200 rounded-xl hover:border-[#CC0000] hover:shadow-sm transition-all duration-150 cursor-pointer group focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2 h-full"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <h3 className="text-sm font-semibold text-[#0F172A] group-hover:text-[#CC0000] transition-colors duration-150 leading-snug">
                              {name}
                            </h3>
                            <svg
                              className="w-4 h-4 text-gray-300 group-hover:text-[#CC0000] transition-colors duration-150 shrink-0 mt-0.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth="2.5"
                              stroke="currentColor"
                              aria-hidden="true"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                            </svg>
                          </div>
                          <p className="text-xs text-[#475569] leading-relaxed mb-3">{desc}</p>
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${levelBadge[level]}`}>
                              {level}
                            </span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
                              {scope}
                            </span>
                          </div>
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>

              </section>
            ))}
          </div>

          {/* Bottom tip */}
          <div className="mt-12 p-4 bg-[#F8FAFC] border border-gray-200 rounded-xl flex items-start gap-3">
            <svg className="w-5 h-5 text-[#475569] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            <p className="text-sm text-[#475569] leading-relaxed">
              Want to see exactly which offices are on your ballot?{" "}
              <a
                href="/ballot"
                className="font-medium text-[#CC0000] hover:underline focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
              >
                Enter your address
              </a>{" "}
              and we&apos;ll show you every race in your precinct.
            </p>
          </div>

        </div>
      </div>

    </main>
  );
}
