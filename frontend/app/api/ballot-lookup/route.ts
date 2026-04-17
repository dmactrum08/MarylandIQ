import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import type { ElectionType } from "@/lib/types";

// ─── Response shapes ──────────────────────────────────────────────────────────

export interface BallotContest {
  contest_slug: string;
  election_type: ElectionType;
  election_date: string; // YYYY-MM-DD
  office_name: string;
  district_name: string | null;
  candidate_count: number;
  href: string;
}

export interface BallotLookupResponse {
  precinct_code: string;
  jurisdiction_id: string;
  jurisdiction_name: string;
  jurisdiction_slug: string;
  contests: BallotContest[];
  matched_address?: string; // what the geocoder resolved to
}

/** Returned when the query is ambiguous — client should show a picker */
export interface BallotLookupAmbiguous {
  ambiguous: true;
  suggestions: AddressSuggestion[];
}

export interface AddressSuggestion {
  display: string;
  lat: number;
  lng: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Ensure Maryland is mentioned so partial queries don't geocode to another state */
function normalizeMarylandAddress(raw: string): string {
  const lower = raw.toLowerCase();
  const hasMd =
    /\bmd\b/.test(lower) ||
    /\bmaryland\b/.test(lower);
  return hasMd ? raw : `${raw.trim()}, MD`;
}

// ─── Census Geocoder ──────────────────────────────────────────────────────────

interface CensusMatch {
  matchedAddress: string;
  coordinates: { x: number; y: number };
}

async function geocodeCensus(
  address: string
): Promise<{ lat: number; lng: number; matched_address: string } | null> {
  const benchmarks = ["Public_AR_Current", "Public_AR_ACS2023", "2020"];

  for (const benchmark of benchmarks) {
    const params = new URLSearchParams({ address, benchmark, format: "json" });
    try {
      const res = await fetch(
        `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params}`,
        { next: { revalidate: 3600 } }
      );
      if (!res.ok) continue;

      const data = (await res.json()) as {
        result?: { addressMatches?: CensusMatch[] };
      };
      const match = data?.result?.addressMatches?.[0];
      if (match) {
        return {
          lat: match.coordinates.y,
          lng: match.coordinates.x,
          matched_address: match.matchedAddress,
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Nominatim Geocoder (OpenStreetMap) — fallback + disambiguation ───────────

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    state?: string;
    country_code?: string;
    county?: string;
    city?: string;
    town?: string;
    village?: string;
    suburb?: string;
  };
}

/** Two results that share the same county and locality are the same place — keep first */
function deduplicateNominatim(results: NominatimResult[]): NominatimResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const county = r.address?.county?.toLowerCase() ?? "";
    const locality = (
      r.address?.city ??
      r.address?.town ??
      r.address?.village ??
      r.address?.suburb ??
      ""
    ).toLowerCase();
    const key = `${county}|${locality}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function geocodeNominatim(
  address: string
): Promise<NominatimResult[]> {
  const params = new URLSearchParams({
    q: address,
    format: "json",
    addressdetails: "1",
    countrycodes: "us",
    limit: "5",
    // Bias results toward Maryland bounding box
    viewbox: "-79.5,37.9,-75.0,39.8",
    bounded: "0", // prefer but don't require the viewbox
  });

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?${params}`,
      {
        headers: { "User-Agent": "MarylandIQ/1.0 (marylandiq.com)" },
        next: { revalidate: 3600 },
      }
    );
    if (!res.ok) return [];
    const raw = (await res.json()) as NominatimResult[];
    // Filter to Maryland only, then collapse duplicates (same county + locality)
    const maryland = raw.filter(
      (r) =>
        r.address?.state?.toLowerCase().includes("maryland") ||
        r.address?.state?.toLowerCase() === "md"
    );
    return deduplicateNominatim(maryland);
  } catch {
    return [];
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  let lat: number | null = null;
  let lng: number | null = null;
  let matchedAddress: string | undefined;

  const rawAddress = searchParams.get("address");
  const rawLat = searchParams.get("lat");
  const rawLng = searchParams.get("lng");

  if (rawLat && rawLng) {
    // Direct lat/lng — no geocoding needed
    lat = parseFloat(rawLat);
    lng = parseFloat(rawLng);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return NextResponse.json(
        { error: "Invalid lat/lng values." },
        { status: 400 }
      );
    }
  } else if (rawAddress) {
    if (rawAddress.length > 500) {
      return NextResponse.json(
        { error: "Address is too long." },
        { status: 400 }
      );
    }
    const address = normalizeMarylandAddress(rawAddress);

    // 1. Try Census first — most accurate for complete addresses
    const census = await geocodeCensus(address);
    if (census) {
      lat = census.lat;
      lng = census.lng;
      matchedAddress = census.matched_address;
    } else {
      // 2. Fall back to Nominatim — handles partial/fuzzy addresses
      const nominatimResults = await geocodeNominatim(address);

      if (nominatimResults.length === 0) {
        return NextResponse.json(
          {
            error:
              "Address not found. Try adding your city and zip code — e.g. \"10 Main St, Rockville, MD 20850\".",
          },
          { status: 422 }
        );
      }

      if (nominatimResults.length === 1) {
        // Unambiguous — proceed
        lat = parseFloat(nominatimResults[0].lat);
        lng = parseFloat(nominatimResults[0].lon);
        matchedAddress = nominatimResults[0].display_name;
      } else {
        // Multiple Maryland matches — ask the client to disambiguate
        const suggestions: AddressSuggestion[] = nominatimResults.map((r) => ({
          display: r.display_name,
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
        }));

        return NextResponse.json(
          { ambiguous: true, suggestions } satisfies BallotLookupAmbiguous,
          { status: 300 }
        );
      }
    }
  } else {
    return NextResponse.json(
      { error: "Provide either ?address= or ?lat=&lng= parameters." },
      { status: 400 }
    );
  }

  const electionType = searchParams.get("election_type") ?? undefined;
  const voterParty = searchParams.get("party") ?? undefined;
  const supabase = createServerClient();

  // Step 1 — identify precinct
  const { data: precinctRows, error: precinctError } = await supabase.rpc(
    "lookup_precinct",
    { p_lat: lat, p_lng: lng }
  );

  if (precinctError) {
    console.error("[ballot-lookup] lookup_precinct error:", precinctError);
    return NextResponse.json({ error: "Precinct lookup failed." }, { status: 500 });
  }

  if (!precinctRows || precinctRows.length === 0) {
    return NextResponse.json(
      {
        error:
          "No Maryland precinct found for that address. Make sure it's a Maryland address — other states aren't supported yet.",
      },
      { status: 404 }
    );
  }

  const precinct = precinctRows[0] as {
    precinct_id: string;
    precinct_code: string;
    jurisdiction_id: string;
  };

  // Step 2 — resolve jurisdiction
  const { data: jurisdictionRow, error: jurError } = await supabase
    .from("jurisdictions")
    .select("id, name, slug")
    .eq("id", precinct.jurisdiction_id)
    .single();

  if (jurError || !jurisdictionRow) {
    console.error("[ballot-lookup] jurisdiction lookup error:", jurError);
    return NextResponse.json(
      { error: "Could not resolve jurisdiction for that precinct." },
      { status: 500 }
    );
  }

  // Step 3 — get contests
  const rpcParams = {
    p_lat: lat,
    p_lng: lng,
    p_election_type: electionType ?? null,
    p_voter_party: voterParty ?? null,
  };

  const { data: contestRows, error: contestError } = await supabase.rpc(
    "lookup_ballot",
    rpcParams
  );

  if (contestError) {
    console.error("[ballot-lookup] lookup_ballot error:", contestError);
    return NextResponse.json({ error: "Contest lookup failed." }, { status: 500 });
  }

  const contests: BallotContest[] = (contestRows ?? []).map(
    (row: {
      contest_slug: string;
      election_type: string;
      election_date: string;
      office_name: string;
      district_name: string | null;
      candidate_count: number;
    }) => ({
      contest_slug: row.contest_slug,
      election_type: row.election_type as ElectionType,
      election_date: row.election_date,
      office_name: row.office_name,
      district_name: row.district_name ?? null,
      candidate_count: Number(row.candidate_count),
      href: `/races/${row.contest_slug}`,
    })
  );

  const response: BallotLookupResponse = {
    precinct_code: precinct.precinct_code,
    jurisdiction_id: precinct.jurisdiction_id,
    jurisdiction_name: jurisdictionRow.name,
    jurisdiction_slug: jurisdictionRow.slug,
    contests,
    ...(matchedAddress ? { matched_address: matchedAddress } : {}),
  };

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
    },
  });
}
