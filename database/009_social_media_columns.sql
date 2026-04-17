-- Migration 009: Add Instagram/Threads social columns and news article URLs
-- Run in Supabase SQL Editor.

ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS instagram_url text,
    ADD COLUMN IF NOT EXISTS threads_url text;

ALTER TABLE candidate_enrichment
    ADD COLUMN IF NOT EXISTS news_article_urls text[] DEFAULT '{}';

COMMENT ON COLUMN candidates.instagram_url IS 'Instagram profile URL for candidate';
COMMENT ON COLUMN candidates.threads_url IS 'Threads profile URL for candidate';
COMMENT ON COLUMN candidate_enrichment.news_article_urls IS
    'News article URLs collected from research CSVs and scraping';
