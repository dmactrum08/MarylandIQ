import LogoMark from "./LogoMark";

const navLinks = [
  { label: "Candidates", href: "/candidates" },
  { label: "Races", href: "/races" },
  { label: "Counties", href: "/counties" },
  { label: "Measures", href: "/measures" },
  { label: "About", href: "/about" },
];

export default function Header() {
  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">

          {/* Logo */}
          <a
            href="/"
            className="shrink-0 rounded focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
            aria-label="MarylandIQ — home"
          >
            <LogoMark size={34} />
          </a>

          {/* Nav */}
          <nav aria-label="Primary navigation">
            <ul className="flex items-center gap-1 flex-wrap justify-end">
              {navLinks.map(({ label, href }) => (
                <li key={href}>
                  <a
                    href={href}
                    className="inline-block px-3 py-2 text-sm font-medium text-[#334155] hover:text-[#0F172A] hover:bg-gray-100 rounded-md transition-colors duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-1"
                  >
                    {label}
                  </a>
                </li>
              ))}
              <li className="ml-1">
                <a
                  href="/ballot"
                  className="inline-block px-4 py-2 text-sm font-semibold text-white bg-[#CC0000] hover:bg-[#AA0000] rounded-md transition-colors duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2 whitespace-nowrap"
                >
                  Look up my ballot
                </a>
              </li>
            </ul>
          </nav>

        </div>
      </div>
    </header>
  );
}
