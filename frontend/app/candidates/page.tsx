import type { Metadata } from "next";
import PageHeader from "@/components/PageHeader";
import { CandidatesFilterForm } from "@/components/AutoFilterForm";
import CandidateResults from "./CandidateResults";
import AdSlot from "@/components/AdSlot";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Browse Candidates",
  description:
    "All active 2026 Maryland candidates — search by name, county, office, or party.",
};

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const county = typeof sp.county === "string" ? sp.county.trim() : "";
  const office = typeof sp.office === "string" ? sp.office.trim() : "";
  const party = typeof sp.party === "string" ? sp.party.trim() : "";
  const page = Math.max(1, parseInt(typeof sp.page === "string" ? sp.page : "1", 10));

  return (
    <main aria-labelledby="candidates-heading" className="flex-1">
      <PageHeader
        title="Browse candidates"
        subtitle="All active 2026 candidates across Maryland — search by name, county, office, or party."
        breadcrumbs={[{ label: "Home", href: "/" }]}
        badge="2026 Election Cycle"
      />

      <div className="bg-white flex-1">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
          <CandidatesFilterForm q={q} county={county} office={office} party={party} />

          <Suspense fallback={<ResultsSkeleton />}>
            <CandidateResults q={q} county={county} office={office} party={party} page={page} />
          </Suspense>

          <AdSlot />
        </div>
      </div>
    </main>
  );
}

function ResultsSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 bg-gray-100 rounded w-32" />
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="h-10 bg-gray-100 border-b border-gray-200" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-gray-50">
            <div className="h-3.5 bg-gray-100 rounded w-1/4" />
            <div className="h-3.5 bg-gray-100 rounded w-1/5" />
            <div className="h-3.5 bg-gray-100 rounded w-1/6" />
            <div className="h-3.5 bg-gray-100 rounded w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
