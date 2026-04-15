import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client for API routes.
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY when available (write operations, bypasses RLS).
 * Falls back to the anon key for read-only routes.
 *
 * Never import this in client components — the service role key must stay server-side.
 */
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
