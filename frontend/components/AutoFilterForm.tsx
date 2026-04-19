"use client";

import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { MD_JURISDICTIONS, MD_OFFICES } from "@/lib/types";

// ─── Candidates filter ────────────────────────────────────────────────────────

const PARTIES = ["All", "Democratic", "Republican", "Green", "Libertarian", "Unaffiliated", "Nonpartisan"];

export function CandidatesFilterForm({
  q,
  county,
  office,
  party,
  incumbent,
}: {
  q: string;
  county: string;
  office: string;
  party: string;
  incumbent: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function buildUrl(overrides: Record<string, string>) {
    const params = new URLSearchParams();
    const values = { q, county, office, party, incumbent: incumbent ? "1" : "", ...overrides };
    if (values.q) params.set("q", values.q);
    if (values.county) params.set("county", values.county);
    if (values.office) params.set("office", values.office);
    if (values.party && values.party !== "All") params.set("party", values.party);
    if (values.incumbent === "1") params.set("incumbent", "1");
    const qs = params.toString();
    return `/candidates${qs ? `?${qs}` : ""}`;
  }

  function navigate(overrides: Record<string, string>) {
    startTransition(() => router.push(buildUrl(overrides), { scroll: false }));
  }

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate({ q: val }), 400);
  }

  const hasFilters = !!(q || county || office || party || incumbent);

  return (
    <div className={`bg-[#F8FAFC] border border-gray-200 rounded-xl p-4 transition-opacity ${isPending ? "opacity-60" : ""}`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Name search */}
        <div className="lg:col-span-2">
          <label htmlFor="q" className="block text-xs font-medium text-[#475569] mb-1">
            Search by name
          </label>
          <input
            id="q"
            type="search"
            defaultValue={q}
            onChange={handleQueryChange}
            placeholder="e.g. Marcus Brown"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-[#0F172A] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:border-transparent"
          />
        </div>

        {/* County */}
        <div>
          <label htmlFor="county" className="block text-xs font-medium text-[#475569] mb-1">
            County
          </label>
          <select
            id="county"
            defaultValue={county}
            onChange={(e) => navigate({ county: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:border-transparent cursor-pointer"
          >
            <option value="">All counties</option>
            {MD_JURISDICTIONS.map((j) => (
              <option key={j.slug} value={j.slug}>{j.name}</option>
            ))}
          </select>
        </div>

        {/* Office */}
        <div>
          <label htmlFor="office" className="block text-xs font-medium text-[#475569] mb-1">
            Office
          </label>
          <select
            id="office"
            defaultValue={office}
            onChange={(e) => navigate({ office: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:border-transparent cursor-pointer"
          >
            <option value="">All offices</option>
            {MD_OFFICES.map((o) => (
              <option key={o.slug} value={o.slug}>{o.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-3">
        {/* Party pills + incumbent toggle */}
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <span className="text-xs font-medium text-[#475569]">Party:</span>
          {PARTIES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => navigate({ party: p === "All" ? "" : p })}
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-1 ${
                (p === "All" && !party) || party === p
                  ? "bg-[#0F172A] text-white border-[#0F172A]"
                  : "bg-white text-[#475569] border-gray-200 hover:border-gray-400"
              }`}
            >
              {p}
            </button>
          ))}
          <span className="w-px h-4 bg-gray-200 mx-1" aria-hidden="true" />
          <button
            type="button"
            onClick={() => navigate({ incumbent: incumbent ? "" : "1" })}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-1 ${
              incumbent
                ? "bg-slate-700 text-white border-slate-700"
                : "bg-white text-[#475569] border-gray-200 hover:border-gray-400"
            }`}
          >
            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Incumbents only
          </button>
        </div>

        {hasFilters && (
          <a
            href="/candidates"
            className="shrink-0 px-4 py-2 text-sm font-medium text-[#475569] hover:text-[#0F172A] border border-gray-200 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
          >
            Clear all
          </a>
        )}
      </div>

      {isPending && (
        <p className="text-xs text-[#94a3b8] mt-2">Filtering…</p>
      )}
    </div>
  );
}

// ─── Races filter ─────────────────────────────────────────────────────────────

export function RacesFilterForm({
  county,
  office,
  electionType,
}: {
  county: string;
  office: string;
  electionType: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function buildUrl(overrides: Record<string, string>) {
    const params = new URLSearchParams();
    const values = { county, office, type: electionType, ...overrides };
    if (values.county) params.set("county", values.county);
    if (values.office) params.set("office", values.office);
    if (values.type) params.set("type", values.type);
    const qs = params.toString();
    return `/races${qs ? `?${qs}` : ""}`;
  }

  function navigate(overrides: Record<string, string>) {
    startTransition(() => router.push(buildUrl(overrides), { scroll: false }));
  }

  const hasFilters = !!(county || office || electionType);

  return (
    <div className={`bg-[#F8FAFC] border border-gray-200 rounded-xl p-4 transition-opacity ${isPending ? "opacity-60" : ""}`}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor="county" className="block text-xs font-medium text-[#475569] mb-1">
            County
          </label>
          <select
            id="county"
            defaultValue={county}
            onChange={(e) => navigate({ county: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:border-transparent cursor-pointer"
          >
            <option value="">All counties</option>
            {MD_JURISDICTIONS.map((j) => (
              <option key={j.slug} value={j.slug}>{j.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="office" className="block text-xs font-medium text-[#475569] mb-1">
            Office
          </label>
          <select
            id="office"
            defaultValue={office}
            onChange={(e) => navigate({ office: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:border-transparent cursor-pointer"
          >
            <option value="">All offices</option>
            {MD_OFFICES.map((o) => (
              <option key={o.slug} value={o.slug}>{o.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="type" className="block text-xs font-medium text-[#475569] mb-1">
            Election type
          </label>
          <select
            id="type"
            defaultValue={electionType}
            onChange={(e) => navigate({ type: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:border-transparent cursor-pointer"
          >
            <option value="">Primary &amp; General</option>
            <option value="primary">Primary only</option>
            <option value="general">General only</option>
          </select>
        </div>
      </div>

      {hasFilters && (
        <div className="flex items-center gap-2 mt-3">
          <a
            href="/races"
            className="px-4 py-2 text-sm font-medium text-[#475569] hover:text-[#0F172A] border border-gray-200 rounded-lg transition-colors"
          >
            Clear filters
          </a>
          {isPending && <span className="text-xs text-[#94a3b8]">Filtering…</span>}
        </div>
      )}
    </div>
  );
}
