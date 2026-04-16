-- Migration 008: add is_incumbent flag to candidates
-- Set manually or via pipeline after cross-referencing current officeholder lists.

ALTER TABLE candidates
    ADD COLUMN IF NOT EXISTS is_incumbent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN candidates.is_incumbent IS
    'True when this candidate currently holds the seat they are running for.
     Set manually or by pipeline after cross-referencing current officeholder data.';
