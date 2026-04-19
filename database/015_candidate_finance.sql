-- MarylandIQ — Migration 015: Campaign finance summary per candidate
-- Run in Supabase SQL Editor.
--
-- Stores aggregated campaign finance data loaded from the MD SBE bulk export.
-- One row per candidate. Written exclusively by the ingest_finance pipeline
-- script using the service role key.

CREATE TABLE IF NOT EXISTS candidate_finance (
    candidate_id        uuid PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
    filing_entity_id    text NOT NULL,          -- MD SBE committee ID
    committee_name      text,                   -- Raw committee name from SBE
    total_raised        numeric(14,2) DEFAULT 0,
    total_spent         numeric(14,2) DEFAULT 0,
    cash_on_hand        numeric(14,2) GENERATED ALWAYS AS (total_raised - total_spent) STORED,
    num_contributions   integer DEFAULT 0,      -- Total contribution transactions
    num_donors          integer DEFAULT 0,      -- Unique donor count (by name+address)
    individual_total    numeric(14,2) DEFAULT 0, -- From individuals
    business_pac_total  numeric(14,2) DEFAULT 0, -- From businesses, PACs, orgs
    self_total          numeric(14,2) DEFAULT 0, -- Self-funded contributions
    data_as_of          date,                   -- Date of the SBE export
    updated_at          timestamptz DEFAULT now()
);

-- RLS: public read, no direct writes
ALTER TABLE candidate_finance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "candidate_finance_public_read" ON candidate_finance
    FOR SELECT TO anon, authenticated USING (true);

COMMENT ON TABLE candidate_finance IS
    'Aggregated MD SBE campaign finance data per candidate. Loaded by ingest_finance.py.';
