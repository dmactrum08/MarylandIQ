-- Migration 011: structured enrichment fields for candidate detail pages
--
-- campaign_voice     — direct quotes/statements from the candidate's own website and social
-- news_summary       — summary of what news coverage and external sources say about them
-- policy_priorities  — structured priority breakdown [{priority, description, source_snippet}]

ALTER TABLE candidate_enrichment
    ADD COLUMN IF NOT EXISTS campaign_voice    text,
    ADD COLUMN IF NOT EXISTS news_summary      text,
    ADD COLUMN IF NOT EXISTS policy_priorities jsonb DEFAULT '[]';
