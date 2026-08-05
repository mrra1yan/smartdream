-- =============================================================================
-- SmartDream — schema fixes from the query-optimization audit (Part 2).
--
-- 1. feed_eligibility_cache was referenced by db/migrations/0002_rpcs.sql
--    (get_eligible_feed_links JOIN + refresh_feed_eligibility_cache +
--    the 120s EVENT) but NEVER created in 0001_schema.sql — a blocker:
--    MySQL compiles procedures lazily, so migration succeeded but every
--    feed call and the cache-refresh EVENT would fail with
--    "Table 'feed_eligibility_cache' doesn't exist". This migration fixes it
--    (port of supabase/migrations/0014's table).
-- 2. profiles.phone is queried by findProfileByPhone (login-by-phone,
--    signup/profile dup checks) but only the generated-phone_key UNIQUE
--    index existed → unindexed lookup. Added a plain (phone) index.
-- 3. blogs: published_at (public list ORDER BY) and created_at (admin list
--    ORDER BY) had no indexes → filesort.
-- =============================================================================

-- ---- 1. feed_eligibility_cache ---------------------------------------------
CREATE TABLE IF NOT EXISTS feed_eligibility_cache (
  user_id      CHAR(36) PRIMARY KEY,
  is_elite     TINYINT(1) NOT NULL DEFAULT 0,
  is_boosted   TINYINT(1) NOT NULL DEFAULT 0,
  boost_order  INT NULL,
  is_slowdown  TINYINT(1) NOT NULL DEFAULT 0,
  refreshed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_fec_user FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---- 2. profiles.phone lookup index ----------------------------------------
ALTER TABLE profiles
  ADD KEY profiles_phone_idx (phone);

-- ---- 3. blogs ordering indexes ---------------------------------------------
ALTER TABLE blogs
  ADD KEY blogs_published_at_idx (published_at),
  ADD KEY blogs_created_at_idx (created_at);

-- ---- 4. Initial eligibility-cache population -------------------------------
-- (Moved here from 0002_rpcs.sql: the refresh procedure references this
-- table, which only exists after the CREATE TABLE above.)
CALL refresh_feed_eligibility_cache();
