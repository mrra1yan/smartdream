-- ============================================================================
-- Reduce sustained database load (resource exhaustion mitigation)
-- ============================================================================
-- The 15-second feed_eligibility_cache refresh was generating ~5,760 heavy
-- aggregate queries per day (full likes table scan each time). Changing to
-- 120s reduces this by 8× while keeping the cache fresh enough for feed
-- ordering. Also adds composite indexes that were missing on frequently
-- filtered column combinations.

-- 1. Reschedule feed_eligibility_cache from 15s → 120s
-- ---------------------------------------------------------------------------
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'refresh_feed_eligibility_cache';
SELECT cron.schedule(
  'refresh_feed_eligibility_cache',
  '120 seconds',
  $$SELECT public.refresh_feed_eligibility_cache();$$
);

-- 2. Composite index for admin dashboard queries
--    Used by: getAdminCounts(), getPendingUsers(), getAllUsers(), searchUsers(),
--             getSuperCounts() — all filter on status + role + is_elite together.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_profiles_status_role_elite
  ON public.profiles (status, role, is_elite);

-- 3. Index for referral counting (getReferralStats)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_profiles_referred_by
  ON public.profiles (referred_by);

-- 4. Index for receiver-side likes aggregation (cache refresh + stats)
--    The cache refresh groups likes by receiver_id with a time window.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_likes_receiver_created
  ON public.likes (receiver_id, created_at DESC);
