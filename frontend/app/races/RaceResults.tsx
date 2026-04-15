"use client";

import { useEffect, useState } from "react";
import type { RaceResult, RacesApiResponse } from "@/app/api/races/route";

function electionBadgeColor(type: string) {
  if (type === "primary") return "bg-purple-100 text-purple-800";
  if (type === "general") return "bg-blue-100 text-blue-800";
  return "bg-amber-100 text-amber-800";
}

function electionLabel(type: string) {
  if (type === "primary") return "Primary";
  if (type === "general") return "General";
  return "Special";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function RaceResults({
  county,
  office,
  electionType,
  page,
}: {
  county: string;
  office: string;
  electionType: string;
  page: number;
}) {
  const [data, setData] = useState<RacesApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);

    const params = new URLSearchParams();
    if (county) params.set("county", county);
    if (office) params.set("office", office);
    if (electionType) params.set("type", electionType);
    if (page > 1) params.set("page", String(page));

    fetch(`/api/races?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json();
      })
      .then((json: RacesApiResponse) => {
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [county, office, electionType, page]);

  function pageUrl(p: number) {
    const params = new URLSearchParams();
    if (county) params.set("county", county);
    if (office) params.set("office", office);
    if (electionType) params.set("type", electionType);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/races${qs ? `?${qs}` : ""}`;
  }

  if (loading) {
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

  if (error) {
    return (
      <div className="py-12 text-center border border-gray-200 rounded-xl bg-[#F8FAFC]">
        <p className="text-sm font-medium text-[#0F172A] mb-1">Unable to load races</p>
        <p className="text-xs text-[#94a3b8]">Please try again.</p>
      </div>
    );
  }

  if (!data) return null;

  const { races, total, page: currentPage, page_size } = data;
  const hasFilters = !!(county || office || electionType);
  const totalPages = Math.ceil(total / page_size);
  const offset = (currentPage - 1) * page_size;
  const showing = races.length;

  return (
    <div className="space-y-4">
      {/* Result count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#475569]">
          {total === 0 ? (
            "No races found"
          ) : (
            <>
              <span className="font-semibold text-[#0F172A]">{total.toLocaleString()}</span>{" "}
              {total === 1 ? "race" : "races"}
              {hasFilters && " matching your filters"}
              {totalPages > 1 && (
                <span className="text-[#94a3b8]">
                  {" "}· showing {offset + 1}–{offset + showing}
                </span>
              )}
            </>
          )}
        </p>
        {hasFilters && total > 0 && (
          <a
            href="/races"
            className="text-xs text-[#94a3b8] hover:text-[#CC0000] transition-colors"
          >
            Clear filters
          </a>
        )}
      </div>

      {races.length === 0 ? (
        <div className="py-16 text-center border border-gray-200 rounded-xl bg-[#F8FAFC]">
          <p className="text-sm font-medium text-[#0F172A] mb-1">No races found</p>
          <p className="text-xs text-[#94a3b8]">Try removing a filter.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">Office</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">County</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">Election</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">Candidates</th>
                  <th className="px-4 py-3" aria-label="View race" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {races.map((c) => (
                  <tr key={c.id} className="hover:bg-[#FFF5F5] transition-colors group">
                    <td className="px-4 py-3">
                      <a
                        href={`/races/${c.slug}`}
                        className="font-medium text-[#0F172A] group-hover:text-[#CC0000] transition-colors focus:outline-none focus:underline"
                      >
                        {c.office_name ?? "—"}
                        {c.district_name && (
                          <span className="text-[#94a3b8] font-normal"> · {c.district_name}</span>
                        )}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      {c.jurisdiction_name ? (
                        <a
                          href={c.jurisdiction_slug ? `/counties/${c.jurisdiction_slug}` : "#"}
                          className="text-[#475569] hover:text-[#CC0000] transition-colors focus:outline-none focus:underline"
                        >
                          {c.jurisdiction_name}
                        </a>
                      ) : (
                        <span className="text-[#94a3b8]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${electionBadgeColor(c.election_type)}`}>
                        {electionLabel(c.election_type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#475569]">{formatDate(c.election_date)}</td>
                    <td className="px-4 py-3 text-[#475569]">
                      {c.candidate_count === 0 ? (
                        <span className="text-[#94a3b8]">None on file</span>
                      ) : c.candidate_count === 1 ? (
                        <span className="text-[#94a3b8]">1 · Uncontested</span>
                      ) : (
                        c.candidate_count
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={`/races/${c.slug}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#CC0000] hover:underline focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
                        aria-label={`View ${c.office_name ?? "race"}`}
                      >
                        View
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="sm:hidden space-y-3" role="list">
            {races.map((c) => (
              <li key={c.id}>
                <a
                  href={`/races/${c.slug}`}
                  className="flex items-start justify-between gap-3 p-4 border border-gray-200 rounded-xl hover:border-[#CC0000] hover:bg-[#FFF5F5] transition-all group focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#0F172A] group-hover:text-[#CC0000] transition-colors">
                      {c.office_name ?? "Unknown office"}
                      {c.district_name && <span className="font-normal text-[#94a3b8]"> · {c.district_name}</span>}
                    </p>
                    <p className="text-xs text-[#475569] mt-0.5">
                      {c.jurisdiction_name ?? ""}
                      {" · "}{formatDate(c.election_date)}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${electionBadgeColor(c.election_type)}`}>
                        {electionLabel(c.election_type)}
                      </span>
                      <span className="text-xs text-[#94a3b8]">
                        {c.candidate_count === 1 ? "1 candidate" : `${c.candidate_count} candidates`}
                      </span>
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-gray-300 group-hover:text-[#CC0000] transition-colors shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </a>
              </li>
            ))}
          </ul>

          {/* Pagination */}
          {totalPages > 1 && (
            <nav aria-label="Race pages" className="flex items-center justify-between pt-2">
              <a
                href={currentPage > 1 ? pageUrl(currentPage - 1) : undefined}
                aria-disabled={currentPage <= 1}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2 ${
                  currentPage <= 1
                    ? "border-gray-100 text-[#94a3b8] pointer-events-none"
                    : "border-gray-200 text-[#475569] hover:border-gray-400 hover:text-[#0F172A]"
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                Previous
              </a>
              <span className="text-sm text-[#475569]">
                Page <span className="font-semibold text-[#0F172A]">{currentPage}</span> of{" "}
                <span className="font-semibold text-[#0F172A]">{totalPages}</span>
              </span>
              <a
                href={currentPage < totalPages ? pageUrl(currentPage + 1) : undefined}
                aria-disabled={currentPage >= totalPages}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2 ${
                  currentPage >= totalPages
                    ? "border-gray-100 text-[#94a3b8] pointer-events-none"
                    : "border-gray-200 text-[#475569] hover:border-gray-400 hover:text-[#0F172A]"
                }`}
              >
                Next
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </a>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
