import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Thank you — MarylandIQ",
};

export default function DonateSuccessPage() {
  return (
    <main className="flex-1 flex items-center justify-center py-24 px-4">
      <div className="max-w-md text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] mb-2">Thank you.</h1>
          <p className="text-[#475569] text-sm leading-relaxed">
            Your contribution helps keep MarylandIQ free and independent through the 2026 election cycle.
            We appreciate the support.
          </p>
        </div>

        <p className="text-xs text-[#94a3b8]">
          A receipt has been sent to your email by Stripe.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Link
            href="/candidates"
            className="inline-flex items-center justify-center px-5 py-2.5 text-sm font-semibold text-white bg-[#CC0000] rounded-lg hover:bg-[#aa0000] transition-colors focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
          >
            Browse candidates
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-5 py-2.5 text-sm font-medium text-[#475569] border border-gray-200 rounded-lg hover:border-gray-400 hover:text-[#0F172A] transition-colors focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
