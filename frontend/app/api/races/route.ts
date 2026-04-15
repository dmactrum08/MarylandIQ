import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 60;

export interface RaceResult {
  id: string;
  slug: string;
  election_type: string;
  election_date: string;
  district_name: string | null;
  office_name: string | null;
  office_slug: string | null;
  jurisdiction_name: string | null;
  jurisdiction_slug: string | null;
  candidate_count: number;
}

export interface RacesApiResponse {
  races: RaceResult[];
  total: number;
  page: number;
  page_size: number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const county = searchParams.get("county")?.trim() ?? "";
  const office = searchParams.get("office")?.trim() ?? "";
  const electionType = searchParams.get("type")?.trim() ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = createServerClient();

  // Resolve slugs to IDs for filtering
  let jurisdictionId: string | null = null;
  let officeId: string | null = null;

  const [jurRes, offRes] = await Promise.all([
    county
      ? supabase.from("jurisdictions").select("id").eq("slug", county).single()
      : Promise.resolve({ data: null }),
    office
      ? supabase.from("offices").select("id").eq("slug", office).single()
      : Promise.resolve({ data: null }),
  ]);

  jurisdictionId = (jurRes as any)?.data?.id ?? null;
  officeId = (offRes as any)?.data?.id ?? null;

  // If slug didn't resolve, return empty
  if ((county && !jurisdictionId) || (office && !officeId)) {
    return NextResponse.json(
      { races: [], total: 0, page, page_size: PAGE_SIZE } satisfies RacesApiResponse,
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  let query = supabase
    .from("contests")
    .select(
      `id, slug, election_type, election_date, district_name,
       office:offices!inner(name, slug),
       jurisdiction:jurisdictions!inner(name, slug)`,
      { count: "exact" }
    )
    .order("election_date", { ascending: true })
    .order("jurisdiction_id", { ascending: true })
    .order("district_name", { ascending: true, nullsFirst: true })
    .range(offset, offset + PAGE_SIZE - 1);

  if (jurisdictionId) query = query.eq("jurisdiction_id", jurisdictionId);
  if (officeId) query = query.eq("office_id", officeId);
  if (electionType) query = query.eq("election_type", electionType);

  const { data, count, error } = await query;

  if (error) {
    console.error("[api/races] query error:", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  // Fetch candidate counts in one query
  const contestIds = (data ?? []).map((c: any) => c.id);
  const { data: candidateCounts } = contestIds.length
    ? await supabase
        .from("candidates")
        .select("contest_id")
        .in("contest_id", contestIds)
        .eq("filing_status", "Active")
    : { data: [] };

  const countMap: Record<string, number> = {};
  for (const row of candidateCounts ?? []) {
    const id = (row as { contest_id: string }).contest_id;
    countMap[id] = (countMap[id] ?? 0) + 1;
  }

  const races: RaceResult[] = (data ?? []).map((row: any) => {
    const off = Array.isArray(row.office) ? row.office[0] : row.office;
    const jur = Array.isArray(row.jurisdiction) ? row.jurisdiction[0] : row.jurisdiction;
    return {
      id: row.id,
      slug: row.slug,
      election_type: row.election_type,
      election_date: row.election_date,
      district_name: row.district_name ?? null,
      office_name: off?.name ?? null,
      office_slug: off?.slug ?? null,
      jurisdiction_name: jur?.name ?? null,
      jurisdiction_slug: jur?.slug ?? null,
      candidate_count: countMap[row.id] ?? 0,
    };
  });

  return NextResponse.json(
    { races, total: count ?? 0, page, page_size: PAGE_SIZE } satisfies RacesApiResponse,
    { headers: { "Cache-Control": "no-store" } }
  );
}
