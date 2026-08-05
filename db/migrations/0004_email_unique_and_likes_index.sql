-- =============================================================================
-- SmartDream — schema fixes from the query-optimization / integrity audit.
--
-- 1. profiles.email has only a non-unique KEY (0001_schema.sql:57), while
--    phone already has a generated-column UNIQUE constraint. Two concurrent
--    signups with the same email can therefore BOTH insert — a duplicate-account
--    bug. Mirroring the phone pattern: a STORED generated `email_key` that maps
--    non-empty emails to LOWER(email) and NULL otherwise, plus a UNIQUE index.
--    The LOWER() makes the constraint case-insensitive (utf8mb4_0900 collation
--    is already accent/case-insensitive, but LOWER() is belt-and-suspenders and
--    makes the value deterministic for inspection).
--
--    SAFETY: if duplicate (case-insensitive) emails already exist, the ADD
--    UNIQUE KEY below will fail with ER_DUP_ENTRY (1062). Run the pre-check
--    query documented at the bottom FIRST to detect conflicts; resolve them
--    before applying this migration.
--
-- 2. process_like_commit (db/migrations/0002_rpcs.sql:392) runs
--    COUNT(*) ... WHERE receiver_id = ? AND is_boosted_like = 0 on every like
--    committed to a non-elite/non-boosted owner. The only covering index is
--    idx_likes_receiver_created_at (receiver_id, created_at) — it forces an
--    index range scan + row filter on is_boosted_like. A dedicated composite
--    index lets MySQL satisfy both the receiver_id equality and the
--    is_boosted_like equality directly from the index.
-- =============================================================================

-- ---- 1. profiles.email generated-column UNIQUE constraint ------------------
ALTER TABLE profiles
  ADD COLUMN email_key VARCHAR(255) GENERATED ALWAYS AS (
    CASE WHEN email IS NOT NULL AND email <> '' THEN LOWER(email) ELSE NULL END
  ) STORED,
  ADD UNIQUE KEY profiles_email_unique (email_key);

-- ---- 2. likes (receiver_id, is_boosted_like) composite index ---------------
ALTER TABLE likes
  ADD KEY idx_likes_receiver_boosted (receiver_id, is_boosted_like);

-- =============================================================================
-- PRE-CHECK (run BEFORE applying if you suspect existing dupes):
--
--   SELECT LOWER(email) AS e, COUNT(*) AS n
--   FROM profiles
--   WHERE email IS NOT NULL AND email <> ''
--   GROUP BY LOWER(email)
--   HAVING COUNT(*) > 1;
--
-- Any rows returned must be merged/de-duped manually first, or the ADD UNIQUE
-- KEY statement above will fail and roll back the whole migration.
-- =============================================================================
