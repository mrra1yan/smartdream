-- =============================================================================
-- 0014_feed_eligibility_cache.sql
--
-- get_eligible_feed_links (0013) recomputed, on every single call, which
-- posters are elite/boosted/new/active-and-not-in-slowdown -- an aggregate
-- over the *entire* likes table (95k+ rows) keyed by receiver_id/liker_id.
-- That computation does not depend on who's asking (viewer_id only affects
-- which of the *links* are shown, via the per-viewer cooldown check and
-- excluding the viewer's own posts) -- so with N users polling the feed
-- every 60s, Postgres was redoing the identical expensive aggregate N times
-- a minute instead of once.
--
-- This snapshots that viewer-independent part into a small cache table,
-- refreshed on a schedule instead of per-request, and has the feed RPC join
-- against the snapshot instead of recomputing it live.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.feed_eligibility_cache (
  user_id       UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_elite      BOOLEAN NOT NULL DEFAULT false,
  is_boosted    BOOLEAN NOT NULL DEFAULT false,
  boost_order   INT,
  is_slowdown   BOOLEAN NOT NULL DEFAULT false,
  refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feed_eligibility_cache ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Recomputes eligibility for every poster and swaps the cache table's
-- contents in a single transaction (readers never see an empty/half-refreshed
-- table -- MVCC holds the pre-refresh rows visible to concurrent readers
-- until this function's transaction commits).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_feed_eligibility_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_active_like_count   INT;
  v_active_window_hours INT;
  v_window_iso          TIMESTAMPTZ;
BEGIN
  SELECT active_like_count, active_window_hours
    INTO v_active_like_count, v_active_window_hours
  FROM public.settings
  LIMIT 1;

  v_window_iso := NOW() - (v_active_window_hours || ' hours')::INTERVAL;

  DELETE FROM public.feed_eligibility_cache;

  INSERT INTO public.feed_eligibility_cache (user_id, is_elite, is_boosted, boost_order, is_slowdown, refreshed_at)
  WITH posters AS (
    SELECT DISTINCT user_id FROM public.links WHERE sort_order >= 0
  ),
  user_stats AS (
    SELECT
      p.id AS user_id,
      p.is_elite,
      p.is_boosted,
      p.boost_order,
      p.created_at AS profile_created_at,
      COALESCE(g.given_24h, 0) AS given_24h,
      COALESCE(r.recv_24h, 0) AS recv_24h,
      COALESCE(r.recv_total, 0) AS recv_total
    FROM posters po
    JOIN public.profiles p ON p.id = po.user_id
    LEFT JOIN (
      SELECT liker_id, COUNT(*) AS given_24h
      FROM public.likes
      WHERE created_at >= v_window_iso
        AND liker_id IN (SELECT user_id FROM posters)
      GROUP BY liker_id
    ) g ON g.liker_id = p.id
    LEFT JOIN (
      SELECT receiver_id,
             COUNT(*) FILTER (WHERE created_at >= v_window_iso) AS recv_24h,
             COUNT(*) AS recv_total
      FROM public.likes
      WHERE is_boosted_like IS DISTINCT FROM true
        AND receiver_id IN (SELECT user_id FROM posters)
      GROUP BY receiver_id
    ) r ON r.receiver_id = p.id
  )
  SELECT
    us.user_id,
    us.is_elite,
    us.is_boosted,
    us.boost_order,
    -- given_24h doubles for the old "active_likes" column from 0013: both
    -- were COUNT(*) over the identical filtered rows, so this preserves that
    -- condition exactly under one name.
    CASE
      WHEN us.given_24h > 0 AND (us.recv_24h::FLOAT / us.given_24h) >= 0.9 THEN true
      ELSE false
    END AS is_slowdown,
    NOW()
  FROM user_stats us
  WHERE us.is_elite = true
     OR us.is_boosted = true
     OR (EXTRACT(EPOCH FROM (NOW() - us.profile_created_at)) < 86400 AND us.recv_total < v_active_like_count)
     OR (us.given_24h >= v_active_like_count AND NOT (us.given_24h > 0 AND us.recv_24h >= us.given_24h));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_feed_eligibility_cache() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_feed_eligibility_cache() TO service_role;

-- Populate immediately so the cache isn't empty until the first cron tick.
SELECT public.refresh_feed_eligibility_cache();

-- Sub-minute schedules are a pg_cron extension (not standard cron syntax).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'refresh_feed_eligibility_cache';
SELECT cron.schedule(
  'refresh_feed_eligibility_cache',
  '15 seconds',
  $$SELECT public.refresh_feed_eligibility_cache();$$
);

-- ---------------------------------------------------------------------------
-- get_eligible_feed_links now joins the cache instead of aggregating `likes`
-- live. p_active_like_count/p_active_window_hours are kept in the signature
-- so src/lib/feed.ts doesn't need to change, but are unused now -- the cache
-- refresh reads those same settings itself on its own schedule.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_eligible_feed_links(
  viewer_id UUID,
  p_active_like_count INT,
  p_active_window_hours INT,
  p_cooldown_hours INT,
  p_limit INT,
  p_offset INT
)
RETURNS TABLE (
  id UUID,
  url TEXT,
  likes_count INT,
  anonymous BOOLEAN,
  is_boosted BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_cooldown_iso TIMESTAMPTZ;
BEGIN
  v_cooldown_iso := NOW() - (p_cooldown_hours || ' hours')::INTERVAL;

  RETURN QUERY
  WITH eligible_links AS (
    SELECT l.id, l.url, l.likes_count, l.user_id, l.created_at
    FROM links l
    WHERE l.sort_order >= 0
      AND l.user_id != viewer_id
      AND NOT EXISTS (
        SELECT 1 FROM likes lk
        WHERE lk.liker_id = viewer_id
          AND lk.link_id = l.id
          AND lk.created_at >= v_cooldown_iso
      )
  ),
  ranked_links AS (
    SELECT
      el.id,
      el.url,
      el.likes_count,
      el.user_id,
      el.created_at,
      ec.is_elite,
      ec.is_boosted,
      ec.boost_order,
      ec.is_slowdown,
      MAX(el.created_at) OVER(PARTITION BY el.user_id) as max_created_at,
      ROW_NUMBER() OVER(PARTITION BY el.user_id ORDER BY el.created_at DESC) as rank_in_user
    FROM eligible_links el
    JOIN public.feed_eligibility_cache ec ON ec.user_id = el.user_id
  )
  SELECT
    rl.id,
    rl.url,
    rl.likes_count,
    rl.is_elite as anonymous,
    rl.is_boosted as is_boosted
  FROM ranked_links rl
  ORDER BY
    rl.is_elite DESC,
    rl.is_boosted DESC,
    CASE WHEN rl.is_elite THEN rl.created_at ELSE NULL END DESC,
    CASE WHEN rl.is_boosted THEN COALESCE(rl.boost_order, 999999999) ELSE NULL END ASC,
    CASE WHEN rl.is_boosted THEN rl.created_at ELSE NULL END DESC,
    rl.rank_in_user ASC,
    rl.is_slowdown ASC,
    rl.max_created_at DESC,
    rl.user_id DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
