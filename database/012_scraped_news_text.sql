-- Migration 009: add scraped_news_text to candidate_enrichment
-- Stores concatenated text fetched from news_article_urls by the scraper pipeline.
-- Kept separate from scraped_website_text so the two sources stay distinct.

ALTER TABLE candidate_enrichment
    ADD COLUMN IF NOT EXISTS scraped_news_text    text,
    ADD COLUMN IF NOT EXISTS news_scraped_at      timestamptz,
    ADD COLUMN IF NOT EXISTS news_scrape_error    boolean DEFAULT false;

COMMENT ON COLUMN candidate_enrichment.scraped_news_text IS
    'Concatenated plain text fetched from news_article_urls by scrape_candidate_websites.py.
     Read by enrich_candidates.py as the NEWS ARTICLES section of the AI prompt.';
