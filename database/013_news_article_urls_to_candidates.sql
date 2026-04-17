-- Migration 010: move news_article_urls from candidate_enrichment to candidates
-- news_article_urls is curated source data, not AI output — belongs with the candidate record.

-- 1. Add column to candidates
ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS news_article_urls text[] DEFAULT '{}';

COMMENT ON COLUMN candidates.news_article_urls IS
    'Manually curated list of news article URLs covering this candidate.
     Scraped by scrape_candidate_websites.py into candidate_enrichment.scraped_news_text.';

-- 2. Copy existing data across
UPDATE candidates c
SET news_article_urls = (
    SELECT ARRAY(SELECT jsonb_array_elements_text(to_jsonb(ce.news_article_urls)))
    FROM candidate_enrichment ce
    WHERE ce.candidate_id = c.id
      AND ce.news_article_urls IS NOT NULL
      AND array_length(ce.news_article_urls, 1) > 0
)
WHERE EXISTS (
    SELECT 1 FROM candidate_enrichment ce
    WHERE ce.candidate_id = c.id
      AND ce.news_article_urls IS NOT NULL
      AND array_length(ce.news_article_urls, 1) > 0
);

-- 3. Drop from candidate_enrichment once all enrichment pipelines are migrated to read from candidates
-- ALTER TABLE candidate_enrichment
--     DROP COLUMN IF EXISTS news_article_urls;
