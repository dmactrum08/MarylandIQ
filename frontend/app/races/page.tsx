import type { Metadata } from "next";
import PageHeader from "@/components/PageHeader";
import { RacesFilterForm } from "@/components/AutoFilterForm";
import RaceResults from "./RaceResults";
import AdSlot from "@/components/AdSlot";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Races",
  description:
    "Browse all 2026 Maryland election races — filter by county, office, or election type.",
};

export default async function RacesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const county = typeof sp.county === "string" ? sp.county.trim() : "";
  const office = typeof sp.office === "string" ? sp.office.trim() : "";
  const electionType = typeof sp.type === "string" ? sp.type.trim() : "";
  const page = Math.max(1, parseInt(typeof sp.page === "string" ? sp.page : "1", 10));

  return (
    <main aria-labelledby="races-heading" className="flex-1">
      <PageHeader
        title="Browse races"
        subtitle="All 2026 Maryland election contests — filter by county, office, or election type."
        breadcrumbs={[{ label: "Home", href: "/" }]}
        badge="2026 Election Cycle"
      />

      <div className="bg-white flex-1">
        <div className="max-w-6xl 2xl:max-w-[1280px] 3xl:max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
          <RacesFilterForm county={county} office={office} electionType={electionType} />

          <Suspense fallback={<ResultsSkeleton />}>
            <RaceResults county={county} office={office} electionType={electionType} page={page} />
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
