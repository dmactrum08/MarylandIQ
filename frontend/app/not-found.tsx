import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page Not Found",
};

export default function NotFound() {
  return (
    <main
      className="flex-1 flex items-center justify-center px-4 py-24"
      aria-labelledby="not-found-heading"
    >
      <div className="max-w-md w-full text-center">

        {/* Status code */}
        <p className="text-8xl font-bold text-[#CC0000] mb-4" aria-hidden="true">
          404
        </p>

        <h1
          id="not-found-heading"
          className="text-2xl font-bold text-[#0F172A] mb-3"
        >
          Page not found
        </h1>

        <p className="text-[#475569] mb-8 leading-relaxed">
          This page doesn&apos;t exist. The candidate, race, or county you&apos;re
          looking for may have moved or never existed in our database.
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a
            href="/"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-[#CC0000] hover:bg-[#AA0000] rounded-lg transition-colors duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
          >
            {/* Home icon */}
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
            Go home
          </a>
          <a
            href="/candidates"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-[#0F172A] border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
          >
            {/* Search icon */}
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            Search candidates
          </a>
        </div>

        {/* Hint */}
        <p className="mt-8 text-xs text-[#94a3b8]">
          Think something is missing?{" "}
          <a
            href="/report"
            className="underline underline-offset-2 hover:text-[#475569] transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
          >
            Report an issue
          </a>
        </p>

      </div>
    </main>
  );
}
