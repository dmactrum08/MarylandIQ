-- Migration 010: allow 'crawl' as a scrape_method value
ALTER TABLE candidate_enrichment
    DROP CONSTRAINT IF EXISTS candidate_enrichment_scrape_method_check;

ALTER TABLE candidate_enrichment
    ADD CONSTRAINT candidate_enrichment_scrape_method_check
    CHECK (scrape_method IN ('requests', 'playwright', 'crawl'));
