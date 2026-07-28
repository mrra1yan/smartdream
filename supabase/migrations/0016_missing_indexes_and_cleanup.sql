-- ============================================================================
-- HOW TO RUN THIS FILE IN THE SUPABASE SQL EDITOR
--
-- Do NOT paste the whole file and hit Run once -- the SQL editor wraps a
-- multi-statement paste in an implicit transaction, and CREATE INDEX
-- CONCURRENTLY is not allowed inside a transaction block (you'll get
-- "ERROR: 25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction
-- block" if you try). Instead, run each numbered STEP below as its own,
-- separate paste + Run click, with nothing else in the query box at the
-- time -- a single standalone statement runs outside any transaction, so
-- CONCURRENTLY works.
--
-- STEP 1, 2, 3: one CONCURRENTLY statement each, run separately.
-- STEP 4 onward: these don't use CONCURRENTLY, so they can be pasted and
-- run together as one block if you prefer.
-- ============================================================================


-- STEP 1 -- run this statement alone.
--
-- links(user_id, sort_order): add_links_atomic()'s per-user active-link
-- COUNT and every per-user link listing filter on both columns, but only
-- links_user_id_idx (user_id alone) exists -- Postgres has to filter
-- sort_order after the index scan instead of satisfying it directly.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_links_user_sort
  ON public.links (user_id, sort_order);


-- STEP 2 -- run this statement alone.
--
-- profiles(is_elite): filtered by refresh_feed_eligibility_cache() (runs
-- every 15s via pg_cron, see 0014_feed_eligibility_cache.sql) and by
-- get_eligible_feed_links()'s ORDER BY. Partial index since elite profiles
-- are expected to be a small minority.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_is_elite
  ON public.profiles (is_elite)
  WHERE is_elite = true;


-- STEP 3 -- run this statement alone.
--
-- profiles(is_boosted, boost_order): same reason as STEP 2, for the
-- boosted-profile path.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_is_boosted_order
  ON public.profiles (is_boosted, boost_order)
  WHERE is_boosted = true;


-- STEP 4 onward -- these do not need CONCURRENTLY. Paste and run everything
-- below as one block.


-- Part 2: drop RPC functions with zero callers in src/ (confirmed via grep
-- of `.rpc(` across the app). get_feed_user_stats in particular does a full
-- unfiltered double-aggregate over likes+profiles -- the exact expensive
-- pattern 0014 already fixed elsewhere via feed_eligibility_cache; it's
-- vestigial now, not called anywhere.
--
-- BEFORE RUNNING THIS SECTION: confirm in the Supabase dashboard that these
-- have no real call volume, e.g.
--   SELECT funcname, calls FROM pg_stat_user_functions
--   WHERE funcname IN ('increment_link_likes','increment_profile_usage','get_feed_user_stats');
-- If you're not sure, skip this section -- it's safe to leave these in
-- place indefinitely, they just sit unused.

DROP FUNCTION IF EXISTS public.increment_link_likes(uuid);
DROP FUNCTION IF EXISTS public.increment_profile_usage(uuid, int, int, int);
DROP FUNCTION IF EXISTS public.get_feed_user_stats(timestamptz, timestamptz);


-- Part 3: retention cleanup for soft-deleted links.
--
-- likes already gets a daily retention cleanup (0009_likes_retention_cleanup.sql).
-- links never does: a deleted link is only soft-deleted (sort_order set
-- negative, url set to 'https://deleted.local' -- see src/app/actions/links.ts),
-- so those rows accumulate forever and bloat links_user_id_idx / idx_links_user_sort
-- indefinitely. 60 days is far longer than likes' 7-day window since links
-- represent user-authored content, not ephemeral activity, and nothing in
-- the app reads a soft-deleted link after the user has moved on from
-- deleting it.

SELECT cron.schedule(
  'cleanup_old_deleted_links',
  '30 20 * * *', -- 20:30 UTC = 02:30 Bangladesh time, low-traffic, staggered after cleanup_old_likes
  $$DELETE FROM public.links WHERE sort_order < 0 AND created_at < now() - interval '60 days'$$
);


-- Part 4: top-likers leaderboard, computed in SQL.
--
-- Replaces src/lib/admin.ts's getTopLikers(), which previously fetched
-- every non-elite role="user" profile (with a per-row embedded like-count)
-- and sorted top-N in application code -- the comment above that function
-- already said "Ideally this should be an RPC or SQL View." This is that
-- RPC: the database does the GROUP BY + ORDER BY + LIMIT directly, so only
-- p_limit rows (default 5) ever cross the wire instead of the full
-- non-elite user list.
CREATE OR REPLACE FUNCTION public.get_top_likers(p_limit INT DEFAULT 5)
RETURNS TABLE (
  id UUID,
  public_id TEXT,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  likes_count BIGINT
)
LANGUAGE sql
AS $$
  SELECT p.id, p.public_id, p.first_name, p.last_name, p.email,
         COUNT(l.id) AS likes_count
  FROM public.profiles p
  LEFT JOIN public.likes l ON l.liker_id = p.id
  WHERE p.is_elite = false AND p.role = 'user'
  GROUP BY p.id
  ORDER BY likes_count DESC
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.get_top_likers(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_likers(INT) TO service_role;
