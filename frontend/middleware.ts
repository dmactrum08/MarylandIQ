import { NextRequest, NextResponse } from "next/server";

// ─── Rate limiting ─────────────────────────────────────────────────────────────
//
// This is an in-memory sliding-window limiter. It works well for single-server
// deployments (traditional Node.js server, Docker, etc.).
//
// If you deploy to a serverless platform (Vercel, AWS Lambda) where each request
// may hit a different worker process, switch to a persistent store:
//   - Vercel KV:    https://vercel.com/docs/storage/vercel-kv
//   - Upstash Redis: https://upstash.com (drop-in, free tier available)
//
// ─────────────────────────────────────────────────────────────────────────────

/** Max requests allowed per IP per window */
const LIMITS: Record<string, number> = {
  "/api/donate":        5,   // Stripe session creation — strictly limited
  "/api/ballot-lookup": 30,  // External geocoding calls
  "/api/report":        10,  // Correction submissions
  "/api/search":        60,  // Autocomplete search
  "/api/candidates":    120, // Candidate list queries
  "/api/races":         120, // Race list queries
};

const WINDOW_MS = 60_000; // 1-minute sliding window

type Entry = { count: number; resetAt: number };
const store = new Map<string, Entry>();

// Prune expired entries to prevent unbounded memory growth
let lastCleanup = Date.now();
function maybeCleanup() {
  const now = Date.now();
  if (now - lastCleanup < 30_000) return; // clean at most every 30s
  lastCleanup = now;
  for (const [key, val] of store) {
    if (now > val.resetAt) store.delete(key);
  }
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Find the most specific matching limit
  const limit = Object.entries(LIMITS).find(([route]) =>
    path.startsWith(route)
  )?.[1];

  if (limit == null) return NextResponse.next();

  maybeCleanup();

  const ip = getClientIp(req);
  const key = `${ip}:${path}`;
  const now = Date.now();

  const entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return NextResponse.next();
  }

  entry.count++;

  if (entry.count > limit) {
    return NextResponse.json(
      { error: "Too many requests — please wait a moment and try again." },
      {
        status: 429,
        headers: {
          "Retry-After": "60",
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
