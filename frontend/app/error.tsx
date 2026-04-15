"use client";

// error.tsx must be a Client Component — Next.js requirement.
// It catches unhandled runtime errors within the route segment.

import { useEffect } from "react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log to console in dev; swap for a real error reporter in production
    console.error("[MarylandIQ] Unhandled error:", error);
  }, [error]);

  return (
    <main
      className="flex-1 flex items-center justify-center px-4 py-24"
      aria-labelledby="error-heading"
    >
      <div className="max-w-md w-full text-center">

        {/* Icon */}
        <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-6" aria-hidden="true">
          <svg className="w-8 h-8 text-[#CC0000]" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>

        <h1
          id="error-heading"
          className="text-2xl font-bold text-[#0F172A] mb-3"
        >
          Something went wrong
        </h1>

        <p className="text-[#475569] mb-8 leading-relaxed">
          An unexpected error occurred. This has been logged. You can try again
          or return to the homepage.
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-[#CC0000] hover:bg-[#AA0000] rounded-lg transition-colors duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
          >
            {/* Refresh icon */}
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-[#0F172A] border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
          >
            Go home
          </a>
        </div>

        {/* Digest for debugging */}
        {error.digest && (
          <p className="mt-6 text-xs text-[#94a3b8] font-mono">
            Error ID: {error.digest}
          </p>
        )}

      </div>
    </main>
  );
}
