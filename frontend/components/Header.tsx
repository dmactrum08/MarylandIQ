"use client";

import { useState } from "react";
import LogoMark from "./LogoMark";

const navLinks = [
  { label: "Candidates", href: "/candidates" },
  { label: "Races", href: "/races" },
  { label: "Counties", href: "/counties" },
  { label: "Measures", href: "/measures" },
  { label: "About", href: "/about" },
];

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
      <div className="max-w-7xl 2xl:max-w-[1400px] 3xl:max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">

          {/* Logo */}
          <a
            href="/"
            className="shrink-0 rounded focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
            aria-label="MarylandIQ home"
          >
            <LogoMark size={34} />
          </a>

          {/* Desktop nav — hidden below md */}
          <nav aria-label="Primary navigation" className="hidden md:block">
            <ul className="flex items-center gap-1">
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
              <li>
                <a
                  href="/donate"
                  className="inline-block px-4 py-2 text-sm font-semibold text-white bg-[#F5A623] hover:bg-[#D97706] rounded-md transition-colors duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#F5A623] focus:ring-offset-1"
                >
                  Contribute
                </a>
              </li>
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

          {/* Mobile: compact CTA + hamburger — visible below md */}
          <div className="flex items-center gap-2 md:hidden">
            <a
              href="/ballot"
              className="inline-block px-3 py-2 text-sm font-semibold text-white bg-[#CC0000] hover:bg-[#AA0000] rounded-md transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
            >
              My ballot
            </a>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label={open ? "Close menu" : "Open menu"}
              className="p-2 rounded-md text-[#334155] hover:text-[#0F172A] hover:bg-gray-100 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-1"
            >
              {open ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              )}
            </button>
          </div>

        </div>
      </div>

      {/* Mobile nav drawer */}
      {open && (
        <div id="mobile-nav" className="md:hidden border-t border-gray-100 bg-white shadow-sm">
          <nav aria-label="Mobile navigation">
            <ul className="px-4 py-2 space-y-0.5">
              {navLinks.map(({ label, href }) => (
                <li key={href}>
                  <a
                    href={href}
                    onClick={() => setOpen(false)}
                    className="flex items-center px-3 py-3 text-sm font-medium text-[#334155] hover:text-[#0F172A] hover:bg-gray-50 rounded-lg transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-1"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="px-4 pb-4 pt-1 space-y-2">
              <a
                href="/donate"
                onClick={() => setOpen(false)}
                className="flex items-center justify-center w-full px-4 py-3 text-sm font-semibold text-white bg-[#F5A623] hover:bg-[#D97706] rounded-lg transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[#F5A623] focus:ring-offset-2"
              >
                Contribute
              </a>
              <a
                href="/ballot"
                onClick={() => setOpen(false)}
                className="flex items-center justify-center w-full px-4 py-3 text-sm font-semibold text-white bg-[#CC0000] hover:bg-[#AA0000] rounded-lg transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
              >
                Look up my ballot
              </a>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
