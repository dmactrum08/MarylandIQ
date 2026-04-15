-- MarylandIQ — Migration 007: Donations log
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS donations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id text UNIQUE NOT NULL,
  amount_cents     integer NOT NULL,
  currency         text NOT NULL DEFAULT 'usd',
  email            text,
  paid_at          timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- No RLS row-level access needed — this table is only written to
-- by the webhook (service role) and read by admins only.
-- Keep it locked down: no anon select.
ALTER TABLE donations ENABLE ROW LEVEL SECURITY;

-- Deny all access to anon and authenticated roles by default.
-- The webhook uses the service role key which bypasses RLS.
