"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import type {
  BallotLookupResponse,
  BallotLookupAmbiguous,
  AddressSuggestion,
  BallotContest,
} from "@/app/api/ballot-lookup/route";

// ─── Types ────────────────────────────────────────────────────────────────────

type Status = "idle" | "loading" | "success" | "error" | "ambiguous";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function electionLabel(type: string) {
  if (type === "primary") return "2026 Primary · June 23, 2026";
  if (type === "general") return "2026 General · November 3, 2026";
  return "2026 Special Election";
}

function electionBadgeColor(type: string) {
  if (type === "primary") return "bg-purple-100 text-purple-800";
  if (type === "general") return "bg-blue-100 text-blue-800";
  return "bg-amber-100 text-amber-800";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-label="Loading ballot…" aria-live="polite">
      <div className="h-5 bg-gray-100 rounded w-1/3" />
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="h-10 bg-gray-100" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <div className="space-y-1.5 flex-1">
              <div className="h-3.5 bg-gray-100 rounded w-2/5" />
              <div className="h-3 bg-gray-50 rounded w-1/4" />
            </div>
            <div className="h-3 bg-gray-100 rounded w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Contest row ──────────────────────────────────────────────────────────────

function ContestRow({ contest }: { contest: BallotContest }) {
  const isUncontested = contest.candidate_count <= 1;
  return (
    <li>
      <a
        href={contest.href}
        className="flex items-center justify-between px-4 py-3 hover:bg-[#FFF5F5] transition-colors group focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#CC0000]"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#0F172A] group-hover:text-[#CC0000] transition-colors">
            {contest.office_name}
            {contest.district_name && (
              <span className="text-[#94a3b8] font-normal"> · {contest.district_name}</span>
            )}
          </p>
          <p className="text-xs text-[#94a3b8] mt-0.5">
            {contest.candidate_count === 0
              ? "No candidates on file"
              : contest.candidate_count === 1
              ? "1 candidate · Uncontested"
              : `${contest.candidate_count} candidates`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {isUncontested && (
            <span className="text-xs text-[#94a3b8]">Uncontested</span>
          )}
          <svg
            className="w-4 h-4 text-gray-300 group-hover:text-[#CC0000] transition-colors"
            fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </div>
      </a>
    </li>
  );
}

// ─── Results display ──────────────────────────────────────────────────────────

function BallotResults({
  result,
  address,
}: {
  result: BallotLookupResponse;
  address: string;
}) {
  // Group contests by election type
  const groups = new Map<string, BallotContest[]>();
  for (const c of result.contests) {
    if (!groups.has(c.election_type)) groups.set(c.election_type, []);
    groups.get(c.election_type)!.push(c);
  }
  const orderedTypes = ["primary", "general", "special"].filter((t) => groups.has(t));

  return (
    <div className="space-y-6" aria-live="polite">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#0F172A]">
            Your ballot in {result.jurisdiction_name}
          </h2>
          <p className="text-sm text-[#475569] mt-0.5">
            Precinct {result.precinct_code} · {address}
          </p>
        </div>
        <a
          href={`/counties/${result.jurisdiction_slug}`}
          className="shrink-0 text-xs font-medium text-[#CC0000] hover:underline focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded"
        >
          All {result.jurisdiction_name} races →
        </a>
      </div>

      {result.contests.length === 0 ? (
        <div className="p-6 bg-[#F8FAFC] border border-gray-200 rounded-xl text-center">
          <p className="text-sm text-[#94a3b8]">
            No upcoming contests found for this precinct. Check back as more data is added.
          </p>
        </div>
      ) : (
        orderedTypes.map((electionType) => {
          const contests = groups.get(electionType)!;
          return (
            <section key={electionType} aria-labelledby={`election-${electionType}`}>
              <div className="flex items-center gap-2 mb-3">
                <h3
                  id={`election-${electionType}`}
                  className="text-sm font-semibold text-[#0F172A]"
                >
                  {electionLabel(electionType)}
                </h3>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${electionBadgeColor(electionType)}`}>
                  {contests.length} {contests.length === 1 ? "race" : "races"}
                </span>
              </div>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <ul role="list" className="divide-y divide-gray-100">
                  {contests.map((c) => (
                    <ContestRow key={c.contest_slug} contest={c} />
                  ))}
                </ul>
              </div>
            </section>
          );
        })
      )}

      {/* Official sample ballot link */}
      <a
        href="https://voterservices.elections.maryland.gov/VoterSearch"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-between w-full px-4 py-3 border border-gray-200 rounded-xl hover:border-[#CC0000] hover:bg-[#FFF5F5] transition-all duration-150 group focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
      >
        <div className="flex items-center gap-3">
          <svg className="w-4 h-4 text-[#CC0000] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-[#0F172A] group-hover:text-[#CC0000] transition-colors">View your official sample ballot</p>
            <p className="text-xs text-[#94a3b8]">Maryland State Board of Elections</p>
          </div>
        </div>
        <svg className="w-4 h-4 text-[#94a3b8] group-hover:text-[#CC0000] transition-colors shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
      </a>

      {/* Trust note */}
      <p className="text-xs text-[#94a3b8] leading-relaxed border-t border-gray-100 pt-4">
        Ballot data is sourced from the Maryland State Board of Elections and updated regularly.
        Verify your official ballot with{" "}
        <a
          href={`/counties/${result.jurisdiction_slug}`}
          className="text-[#CC0000] hover:underline"
        >
          {result.jurisdiction_name} Board of Elections
        </a>
        . Your address was not stored.
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BallotLookup() {
  const searchParams = useSearchParams();
  const [address, setAddress] = useState("");
  const [submittedAddress, setSubmittedAddress] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<BallotLookupResponse | null>(null);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const lookupByCoords = useCallback(async (lat: number, lng: number, display: string) => {
    setStatus("loading");
    setSuggestions([]);
    setSubmittedAddress(display);
    try {
      const res = await fetch(`/api/ballot-lookup?lat=${lat}&lng=${lng}`);
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.error ?? "Something went wrong.");
      } else {
        const ballotData = data as BallotLookupResponse;
        setResult(ballotData);
        setStatus("success");
        window.history.replaceState(null, "", `/ballot?address=${encodeURIComponent(display)}`);
        setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      }
    } catch {
      setStatus("error");
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    }
  }, []);

  const lookup = useCallback(async (addressToLookup: string) => {
    if (!addressToLookup.trim()) return;
    setStatus("loading");
    setResult(null);
    setSuggestions([]);
    setErrorMessage("");
    setSubmittedAddress(addressToLookup.trim());

    try {
      const res = await fetch(
        `/api/ballot-lookup?address=${encodeURIComponent(addressToLookup.trim())}`
      );
      const data = await res.json();

      if (res.status === 300 && (data as BallotLookupAmbiguous).ambiguous) {
        // Multiple possible addresses — show picker
        setSuggestions((data as BallotLookupAmbiguous).suggestions);
        setStatus("ambiguous");
        setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
        return;
      }

      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.error ?? "Something went wrong. Please try again.");
      } else {
        const ballotData = data as BallotLookupResponse;
        setResult(ballotData);
        setStatus("success");
        window.history.replaceState(null, "", `/ballot?address=${encodeURIComponent(addressToLookup.trim())}`);
        setTimeout(() => {
          resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
      }
    } catch {
      setStatus("error");
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    }
  }, []);

  // On mount: restore address from URL (works after back-navigation)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prefill = params.get("address") || searchParams.get("address");
    if (prefill && prefill.trim()) {
      setAddress(prefill.trim());
      lookup(prefill.trim());
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    lookup(address);
  };

  const handleGeolocate = () => {
    if (!navigator.geolocation) {
      setErrorMessage("Your browser does not support location access.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setResult(null);
    setErrorMessage("");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setSubmittedAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
        try {
          const res = await fetch(`/api/ballot-lookup?lat=${lat}&lng=${lng}`);
          const data = await res.json();
          if (!res.ok) {
            setStatus("error");
            setErrorMessage(data.error ?? "Something went wrong. Please try again.");
          } else {
            setResult(data as BallotLookupResponse);
            setStatus("success");
            setTimeout(() => {
              resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 100);
          }
        } catch {
          setStatus("error");
          setErrorMessage("Could not reach the server. Check your connection and try again.");
        }
      },
      () => {
        setStatus("idle");
        setErrorMessage("Location access was denied. Enter your address manually.");
      },
      { timeout: 10000 }
    );
  };

  const handleReset = () => {
    setStatus("idle");
    setResult(null);
    setErrorMessage("");
    setAddress("");
    setSubmittedAddress("");
    window.history.replaceState(null, "", "/ballot");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <main aria-labelledby="ballot-heading" className="flex-1 bg-white">

      {/* ── Hero / Input Section ── */}
      <div className="bg-[#0F172A]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <nav aria-label="Breadcrumb" className="mb-6">
            <ol className="flex items-center gap-2 text-sm">
              <li>
                <a href="/" className="text-slate-400 hover:text-white transition-colors">
                  Home
                </a>
              </li>
              <li aria-hidden="true" className="text-slate-600">›</li>
              <li className="text-slate-300">Ballot lookup</li>
            </ol>
          </nav>

          <h1
            id="ballot-heading"
            className="text-2xl sm:text-3xl font-bold text-white mb-3"
          >
            Look up your ballot
          </h1>
          <p className="text-slate-300 text-sm sm:text-base leading-relaxed mb-8">
            Enter your Maryland address to see every race on your 2026 ballot:
            school board, county council, sheriff, state&apos;s attorney, and more.
          </p>

          {/* Address form */}
          <form onSubmit={handleSubmit} noValidate>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <label htmlFor="address-input" className="sr-only">
                  Your Maryland address
                </label>
                <input
                  id="address-input"
                  ref={inputRef}
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="123 Main St, Rockville, MD 20850"
                  autoComplete="street-address"
                  disabled={status === "loading"}
                  className="w-full px-4 py-3 text-sm sm:text-base bg-white border border-white/20 rounded-xl text-[#0F172A] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#CC0000] disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>
              <button
                type="submit"
                disabled={status === "loading" || !address.trim()}
                className="px-5 py-3 text-sm font-semibold text-white bg-[#CC0000] hover:bg-[#AA0000] rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2 focus:ring-offset-[#0F172A] disabled:opacity-50 disabled:cursor-not-allowed shrink-0 cursor-pointer"
              >
                {status === "loading" ? (
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Looking up…
                  </span>
                ) : "Look up"}
              </button>
            </div>

            {/* Geolocation fallback */}
            <div className="flex items-center gap-3 mt-3">
              <button
                type="button"
                onClick={handleGeolocate}
                disabled={status === "loading"}
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-white rounded cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
                Use my current location
              </button>
              <span className="text-slate-700 text-xs">·</span>
              <span className="text-xs text-slate-500">Maryland addresses only · Address not stored</span>
            </div>
          </form>

          {/* Inline error under the form */}
          {status === "error" && errorMessage && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 px-4 py-3 bg-red-900/30 border border-red-500/30 rounded-xl"
            >
              <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <div>
                <p className="text-sm text-red-300">{errorMessage}</p>
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-xs text-red-400 hover:text-red-200 underline mt-1 focus:outline-none cursor-pointer"
                >
                  Try again
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Results Section ── */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10" ref={resultsRef}>
        {status === "loading" && <Skeleton />}

        {status === "ambiguous" && suggestions.length > 0 && (
          <div aria-live="polite" className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-[#0F172A]">
                We found multiple Maryland addresses. Which one did you mean?
              </h2>
              <p className="text-sm text-[#475569] mt-1">
                Select the correct address below to look up your ballot.
              </p>
            </div>
            <ul className="space-y-2">
              {suggestions.map((s, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => lookupByCoords(s.lat, s.lng, s.display)}
                    className="w-full text-left px-4 py-3 border border-gray-200 rounded-xl hover:border-[#CC0000] hover:bg-[#FFF5F5] transition-all text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2 cursor-pointer"
                  >
                    {s.display}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 text-sm text-[#475569] hover:text-[#0F172A] transition-colors focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Try a different address
            </button>
          </div>
        )}

        {status === "success" && result && (
          <div className="space-y-6">
            <BallotResults result={result} address={submittedAddress} />
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 text-sm text-[#475569] hover:text-[#0F172A] transition-colors focus:outline-none focus:ring-1 focus:ring-[#CC0000] rounded cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Look up a different address
            </button>
          </div>
        )}

        {status === "idle" && (
          <div className="space-y-8">
            {/* How it works */}
            <div>
              <h2 className="text-base font-semibold text-[#0F172A] mb-4">How ballot lookup works</h2>
              <ol className="space-y-4">
                {[
                  {
                    n: "1",
                    title: "Address → coordinates",
                    body: "Your address is geocoded using the free U.S. Census Geocoder. No account or API key required.",
                  },
                  {
                    n: "2",
                    title: "Coordinates → precinct",
                    body: "We match your location against Maryland precinct boundary polygons to identify which precinct you're in.",
                  },
                  {
                    n: "3",
                    title: "Precinct → ballot",
                    body: "We return every upcoming contest assigned to your precinct. Each links to candidate profiles with sourced data.",
                  },
                ].map((step) => (
                  <li key={step.n} className="flex items-start gap-4">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#CC0000] text-white text-xs font-bold shrink-0 mt-0.5">
                      {step.n}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[#0F172A]">{step.title}</p>
                      <p className="text-xs text-[#475569] leading-relaxed mt-0.5">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* Privacy note */}
            <div className="p-4 bg-[#F8FAFC] border border-gray-200 rounded-xl">
              <p className="text-xs text-[#475569] leading-relaxed">
                <span className="font-semibold text-[#0F172A]">Your address is not stored.</span>{" "}
                Geocoding is ephemeral. Only the derived precinct ID is used. MarylandIQ does not
                build voter profiles and does not sell data.{" "}
                <a href="/privacy" className="text-[#CC0000] hover:underline">Privacy policy →</a>
              </p>
            </div>

            {/* Browse fallback */}
            <div className="border-t border-gray-100 pt-6">
              <p className="text-sm text-[#475569] mb-3">
                Prefer to browse without an address?
              </p>
              <div className="flex flex-wrap gap-3">
                <a
                  href="/counties"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-[#0F172A] border border-gray-200 rounded-lg hover:border-[#CC0000] hover:text-[#CC0000] transition-colors focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
                >
                  Browse by county
                </a>
                <a
                  href="/candidates"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-[#0F172A] border border-gray-200 rounded-lg hover:border-[#CC0000] hover:text-[#CC0000] transition-colors focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2"
                >
                  Browse all candidates
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
