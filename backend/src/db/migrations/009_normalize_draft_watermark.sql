-- Migration: "DRAFT" is no longer a valid saved template watermark (FR-017 fix).
-- It's applied automatically to every unapproved document based on status, not
-- chosen per template — see resolveWatermarkForStatus() in documentAssembler.js and
-- normalizeWatermarkText() in templateController.js, which now rejects new saves of
-- "DRAFT". This migration clears out any template row saved before that validation
-- existed, so a signed/final document generated from it falls back to the normal
-- default (FINAL) instead of being stuck showing "DRAFT" forever.
-- Run this once against an existing database; fresh installs never hit this state.

UPDATE templates
SET watermark_text = NULL
WHERE UPPER(TRIM(watermark_text)) = 'DRAFT';
