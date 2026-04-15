"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CandidateResult, CandidatesApiResponse } from "@/app/api/candidates/route";

const PARTY_COLORS: Record<string, string> = {
  Democratic: "bg-blue-50 text-blue-700 border-blue-200",
  Republican: "bg-red-50 text-red-700 border-red-200",
  Green: "bg-green-50 text-green-700 border-green-200",
  Libertarian: "bg-yellow-50 text-yellow-700 border-yellow-200",
  Unaffiliated: "bg-gray-50 text-gray-600 border-gray-200",
  Nonpartisan: "bg-gray-50 text-gray-600 border-gray-200",
};

function partyBadge(party: string | null) {
  if (!party) return null;
  const cls = PARTY_COLORS[party] ?? "bg-gray-50 text-gray-600 border-gray-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {party}
    </span>
  );
}

export default function CandidateResults({
  q,
  county,
  office,
  party,
  page,
}: {
  q: string;
  county: string;
  office: string;
  party: string;
  page: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [data, setData] = useState<CandidatesApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);

    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (county) params.set("county", county);
    if (office) params.set("office", office);
    if (party) params.set("party", party);
    if (page > 1) params.set("page", String(page));

    fetch(`/api/candidates?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json();
      })
      .then((json: CandidatesApiResponse) => {
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [q, county, office, party, page]);

  function pageUrl(p: number) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (county) params.set("county", county);
    if (office) params.set("office", office);
    if (party && party !== "All") params.set("party", party);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/candidates${qs ? `?${qs}` : ""}`;
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
        <p className="text-sm font-medium text-[#0F172A] mb-1">Unable to load candidates</p>
        <p className="text-xs text-[#94a3b8]">Please try again.</p>
      </div>
    );
  }

  if (!data) return null;

  const { candidates, total, page: currentPage, page_size } = data;
  const hasFilters = !!(q || county || office || party);
  const totalPages = Math.ceil(total / page_size);
  const offset = (currentPage - 1) * page_size;
  const showing = candidates.length;

  return (
    <div className="space-y-4">
      {/* Result count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#475569]">
          {total === 0 ? (
            "No candidates found"
          ) : (
            <>
              <span className="font-semibold text-[#0F172A]">{total.toLocaleString()}</span>{" "}
              {total === 1 ? "candidate" : "candidates"}
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
            href="/candidates"
            className="text-xs text-[#94a3b8] hover:text-[#CC0000] transition-colors"
          >
            Clear filters
          </a>
        )}
      </div>

      {candidates.length === 0 ? (
        <div className="py-16 text-center border border-gray-200 rounded-xl bg-[#F8FAFC]">
          <p className="text-sm font-medium text-[#0F172A] mb-1">No candidates found</p>
          <p className="text-xs text-[#94a3b8]">Try a different name, county, office, or party.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
                    Office
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
                    County
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
                    Party
                  </th>
                  <th className="px-4 py-3" aria-label="View candidate" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {candidates.map((c) => (
                  <tr key={c.id} className="hover:bg-[#FFF5F5] transition-colors group">
                    <td className="px-4 py-3">
                      <a
                        href={`/candidates/${c.slug}`}
                        className="font-medium text-[#0F172A] group-hover:text-[#CC0000] transition-colors focus:outline-none focus:underline"
                      >
                        {c.full_name}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-[#475569]">
                      {c.office_name ? (
                        <a
                          href={c.office_slug ? `/offices/${c.office_slug}` : "#"}
                          className="hover:text-[#CC0000] transition-colors focus:outline-none focus:underline"
                        >
                          {c.office_name}
                          {c.district_name && (
                            <span className="text-[#94a3b8]"> · {c.district_name}</span>
                          )}
                        </a>
                      ) : (
                        <span className="text-[#94a3b8]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#475569]">
                      {c.jurisdiction_name ? (
                        <a
                          href={c.jurisdiction_slug ? `/counties/${c.jurisdiction_slug}` : "#"}
                          className="hover:text-[#CC0000] transition-colors focus:outline-none focus:underline"
                        >
                          {c.jurisdiction_name}
                        </a>
                      ) : (
                        <span className="text-[#94a3b8]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{partyBadge(c.party)}</td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={`/candidates/${c.slug}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#CC0000] hover:underline focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
                        aria-label={`View ${c.full_name}`}
                      >
                        View
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth="2.5"
                          stroke="currentColor"
                          aria-hidden="true"
                        >
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
            {candidates.map((c) => (
              <li key={c.id}>
                <a
                  href={`/candidates/${c.slug}`}
                  className="flex items-start justify-between gap-3 p-4 border border-gray-200 rounded-xl hover:border-[#CC0000] hover:bg-[#FFF5F5] transition-all group focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#0F172A] group-hover:text-[#CC0000] transition-colors">
                      {c.full_name}
                    </p>
                    <p className="text-xs text-[#475569] mt-0.5">
                      {c.office_name ?? "Unknown office"}
                      {c.district_name && (
                        <span className="text-[#94a3b8]"> · {c.district_name}</span>
                      )}
                    </p>
                    {c.jurisdiction_name && (
                      <p className="text-xs text-[#94a3b8] mt-0.5">{c.jurisdiction_name}</p>
                    )}
                    {c.party && (
                      <div className="mt-2">{partyBadge(c.party)}</div>
                    )}
                  </div>
                  <svg
                    className="w-4 h-4 text-gray-300 group-hover:text-[#CC0000] transition-colors shrink-0 mt-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="2.5"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </a>
              </li>
            ))}
          </ul>

          {/* Pagination */}
          {totalPages > 1 && (
            <nav aria-label="Candidate pages" className="flex items-center justify-between pt-2">
              <a
                href={currentPage > 1 ? pageUrl(currentPage - 1) : undefined}
                aria-disabled={currentPage <= 1}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2 ${
                  currentPage <= 1
                    ? "border-gray-100 text-[#94a3b8] pointer-events-none"
                    : "border-gray-200 text-[#475569] hover:border-gray-400 hover:text-[#0F172A]"
                }`}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="2.5"
                  stroke="currentColor"
                  aria-hidden="true"
                >
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
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="2.5"
                  stroke="currentColor"
                  aria-hidden="true"
                >
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
