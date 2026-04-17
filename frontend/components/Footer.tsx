import LogoMark from "./LogoMark";

const exploreLinks = [
  { label: "All Candidates", href: "/candidates" },
  { label: "All Races", href: "/races" },
  { label: "All Counties", href: "/counties" },
  { label: "Office Types", href: "/offices" },
  { label: "Ballot Measures", href: "/measures" },
];

const legalLinks = [
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
  { label: "About MarylandIQ", href: "/about" },
  { label: "Contact", href: "/contact" },
];

const dataLinks = [
  { label: "Report an Issue", href: "/report" },
  { label: "About the Data", href: "/about#data" },
  { label: "Look Up My Ballot", href: "/ballot" },
];

const supportLinks = [
  { label: "Support MarylandIQ", href: "/donate" },
];

export default function Footer() {
  return (
    <footer className="bg-[#0F172A] text-slate-400" aria-label="Site footer">
      <div className="max-w-7xl 2xl:max-w-[1400px] 3xl:max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">

          {/* Brand column */}
          <div className="lg:col-span-1">
            <a
              href="/"
              className="inline-flex mb-3 rounded focus:outline-none focus:ring-2 focus:ring-[#F5A623]"
              aria-label="MarylandIQ home"
            >
              <LogoMark size={28} dark />
            </a>
            <p className="text-sm leading-relaxed text-slate-500">
              Maryland voter research for local elections. County-level races, all 24 jurisdictions.
            </p>
          </div>

          {/* Explore */}
          <nav aria-label="Explore site">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">
              Explore
            </h3>
            <ul className="space-y-2">
              {exploreLinks.map(({ label, href }) => (
                <li key={href}>
                  <a
                    href={href}
                    className="text-sm hover:text-white transition-colors duration-150 cursor-pointer focus:outline-none focus:underline"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {/* Legal */}
          <nav aria-label="Legal">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">
              Legal
            </h3>
            <ul className="space-y-2">
              {legalLinks.map(({ label, href }) => (
                <li key={href}>
                  <a
                    href={href}
                    className="text-sm hover:text-white transition-colors duration-150 cursor-pointer focus:outline-none focus:underline"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {/* Data */}
          <nav aria-label="Data and corrections">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">
              Data
            </h3>
            <ul className="space-y-2">
              {dataLinks.map(({ label, href }) => (
                <li key={href}>
                  <a
                    href={href}
                    className="text-sm hover:text-white transition-colors duration-150 cursor-pointer focus:outline-none focus:underline"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-xs text-slate-600">
            © 2026 MarylandIQ · Data sourced from the Maryland State Board of Elections
          </p>
          <div className="flex items-center gap-4">
            <a
              href="/donate"
              className="text-xs text-[#F5A623] hover:text-white transition-colors duration-150 cursor-pointer focus:outline-none focus:underline"
            >
              Support MarylandIQ
            </a>
            <p className="text-xs text-slate-600">
              Not affiliated with any government agency or political organization
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
