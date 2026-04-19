import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 60;

export interface CandidateResult {
  id: string;
  slug: string;
  full_name: string;
  party: string | null;
  is_incumbent: boolean;
  completeness_score: number;
  contest_slug: string | null;
  election_type: string | null;
  district_name: string | null;
  office_name: string | null;
  office_slug: string | null;
  jurisdiction_name: string | null;
  jurisdiction_slug: string | null;
}

export interface CandidatesApiResponse {
  candidates: CandidateResult[];
  total: number;
  page: number;
  page_size: number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const q = (searchParams.get("q")?.trim() ?? "").slice(0, 200);
  const county = searchParams.get("county")?.trim() ?? "";
  const office = searchParams.get("office")?.trim() ?? "";
  const party = searchParams.get("party")?.trim() ?? "";
  const incumbentOnly = searchParams.get("incumbent") === "1";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = createServerClient();

  // ── Single query: join contests → jurisdictions + offices inline ──────────
  // Fixes the 3-round-trip slug→ID resolution by filtering inside Supabase
  // using the foreign table columns directly.

  let query = supabase
    .from("candidates")
    .select(
      `
      id, slug, full_name, party, is_incumbent, completeness_score,
      contest:contests!inner(
        slug, election_type, district_name,
        office:offices!inner(name, slug),
        jurisdiction:jurisdictions!inner(name, slug)
      )
      `,
      { count: "exact" }
    )
    .eq("filing_status", "Active")
    .order("full_name", { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  if (q) query = query.ilike("full_name", `%${q}%`);
  if (party) query = query.eq("party", party);
  if (incumbentOnly) query = query.eq("is_incumbent", true);
  if (county) query = query.eq("contests.jurisdictions.slug", county);
  if (office) query = query.eq("contests.offices.slug", office);

  const { data, count, error } = await query;

  if (error) {
    console.error("[api/candidates] query error:", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const candidates: CandidateResult[] = (data ?? []).map((row: any) => {
    const contest = Array.isArray(row.contest) ? row.contest[0] : row.contest;
    const off = contest ? (Array.isArray(contest.office) ? contest.office[0] : contest.office) : null;
    const jur = contest ? (Array.isArray(contest.jurisdiction) ? contest.jurisdiction[0] : contest.jurisdiction) : null;
    return {
      id: row.id,
      slug: row.slug,
      full_name: row.full_name,
      party: row.party ?? null,
      is_incumbent: row.is_incumbent ?? false,
      completeness_score: row.completeness_score ?? 0,
      contest_slug: contest?.slug ?? null,
      election_type: contest?.election_type ?? null,
      district_name: contest?.district_name ?? null,
      office_name: off?.name ?? null,
      office_slug: off?.slug ?? null,
      jurisdiction_name: jur?.name ?? null,
      jurisdiction_slug: jur?.slug ?? null,
    };
  });

  return NextResponse.json(
    { candidates, total: count ?? 0, page, page_size: PAGE_SIZE } satisfies CandidatesApiResponse,
    { headers: { "Cache-Control": "no-store" } }
  );
}
