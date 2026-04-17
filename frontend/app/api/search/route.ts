import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import type { SearchResult } from "@/lib/types";

const MAX_RESULTS = 20;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 200;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q")?.trim() ?? "";

  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `Query must be at least ${MIN_QUERY_LENGTH} characters.` },
      { status: 400 }
    );
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `Query must be ${MAX_QUERY_LENGTH} characters or fewer.` },
      { status: 400 }
    );
  }

  const supabase = createServerClient();
  const results: SearchResult[] = [];

  // ── Candidate search ──────────────────────────────────────────────────────
  // Uses ilike on full_name; full-text search can be added once a tsvector
  // column/index is configured in Supabase.
  const { data: candidates, error: candError } = await supabase
    .from("candidates")
    .select(
      `
      slug,
      full_name,
      party,
      filing_status,
      contest:contests (
        slug,
        election_type,
        district_name,
        office:offices ( name ),
        jurisdiction:jurisdictions ( name, slug )
      )
    `
    )
    .ilike("full_name", `%${q}%`)
    .eq("filing_status", "Active")
    .limit(MAX_RESULTS);

  if (candError) {
    console.error("[search] candidate query error:", candError);
  } else {
    for (const c of candidates ?? []) {
      // The join returns a single object, not an array
      const contest = Array.isArray(c.contest) ? c.contest[0] : c.contest;
      const office = Array.isArray(contest?.office)
        ? contest.office[0]
        : contest?.office;
      const jurisdiction = Array.isArray(contest?.jurisdiction)
        ? contest.jurisdiction[0]
        : contest?.jurisdiction;

      const officeName = office?.name ?? "Unknown office";
      const jurisName = jurisdiction?.name ?? "";
      const district = contest?.district_name ? ` · ${contest.district_name}` : "";
      const party = c.party ? ` (${c.party})` : "";

      results.push({
        type: "candidate",
        slug: c.slug,
        display_name: `${c.full_name}${party}`,
        subtitle: `${officeName}${district} · ${jurisName}`,
        href: `/candidates/${c.slug}`,
      });
    }
  }

  // ── Contest / race search — by office name or district ───────────────────
  const { data: contests, error: contestError } = await supabase
    .from("contests")
    .select(
      `
      slug,
      election_type,
      election_date,
      district_name,
      office:offices ( name ),
      jurisdiction:jurisdictions ( name, slug )
    `
    )
    .or(
      `district_name.ilike.%${q}%`
    )
    .limit(MAX_RESULTS);

  // Also search by office name via a separate query
  const { data: contestsByOffice, error: officeSearchError } = await supabase
    .from("contests")
    .select(
      `
      slug,
      election_type,
      election_date,
      district_name,
      office:offices!inner ( name ),
      jurisdiction:jurisdictions ( name, slug )
    `
    )
    .ilike("offices.name", `%${q}%`)
    .limit(MAX_RESULTS);

  if (contestError) {
    console.error("[search] contest query error:", contestError);
  }
  if (officeSearchError) {
    console.error("[search] office name search error:", officeSearchError);
  }

  const allContests = [
    ...(contests ?? []),
    ...(contestsByOffice ?? []),
  ];

  // Deduplicate by slug
  const seenContestSlugs = new Set<string>();
  for (const c of allContests) {
    if (seenContestSlugs.has(c.slug)) continue;
    seenContestSlugs.add(c.slug);

    const office = Array.isArray(c.office) ? c.office[0] : c.office;
    const jurisdiction = Array.isArray(c.jurisdiction)
      ? c.jurisdiction[0]
      : c.jurisdiction;

    const officeName = office?.name ?? "Unknown office";
    const jurisName = jurisdiction?.name ?? "";
    const district = c.district_name ? ` · ${c.district_name}` : "";
    const electionLabel =
      c.election_type === "primary"
        ? "Primary"
        : c.election_type === "general"
        ? "General"
        : "Special";

    results.push({
      type: "contest",
      slug: c.slug,
      display_name: `${officeName}${district}`,
      subtitle: `${electionLabel} · ${jurisName} · ${c.election_date}`,
      href: `/races/${c.slug}`,
    });
  }

  // ── Jurisdiction search ───────────────────────────────────────────────────
  const { data: jurisdictions, error: jurError } = await supabase
    .from("jurisdictions")
    .select("slug, name")
    .ilike("name", `%${q}%`)
    .limit(10);

  if (jurError) {
    console.error("[search] jurisdiction query error:", jurError);
  } else {
    for (const j of jurisdictions ?? []) {
      results.push({
        type: "jurisdiction",
        slug: j.slug,
        display_name: j.name,
        subtitle: "Browse all candidates and races",
        href: `/counties/${j.slug}`,
      });
    }
  }

  return NextResponse.json(
    { q, results: results.slice(0, MAX_RESULTS) },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    }
  );
}
