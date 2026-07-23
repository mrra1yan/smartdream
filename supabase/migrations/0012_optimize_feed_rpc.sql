-- 0012_optimize_feed_rpc.sql
-- Replaces the slow Node.js-based N+1 feed filtering with a single highly-optimized RPC.

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
  v_window_iso TIMESTAMPTZ;
  v_cooldown_iso TIMESTAMPTZ;
BEGIN
  v_window_iso := NOW() - (p_active_window_hours || ' hours')::INTERVAL;
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
  unique_users AS (
    SELECT DISTINCT user_id FROM eligible_links
  ),
  user_stats AS (
    SELECT 
      u.user_id,
      p.created_at as profile_created_at,
      p.is_elite,
      COALESCE(g.active_likes, 0) as active_likes,
      COALESCE(g.given_24h, 0) as given_24h,
      COALESCE(r.recv_24h, 0) as recv_24h,
      COALESCE(r.recv_total, 0) as recv_total
    FROM unique_users u
    JOIN profiles p ON p.id = u.user_id
    LEFT JOIN (
      SELECT liker_id, 
             COUNT(*) as active_likes, 
             COUNT(*) as given_24h
      FROM likes 
      WHERE created_at >= v_window_iso 
        AND liker_id IN (SELECT user_id FROM unique_users)
      GROUP BY liker_id
    ) g ON g.liker_id = u.user_id
    LEFT JOIN (
      SELECT receiver_id,
             COUNT(*) FILTER (WHERE created_at >= v_window_iso) as recv_24h,
             COUNT(*) as recv_total
      FROM likes
      WHERE is_boosted_like IS DISTINCT FROM true
        AND receiver_id IN (SELECT user_id FROM unique_users)
      GROUP BY receiver_id
    ) r ON r.receiver_id = u.user_id
  ),
  eligible_users AS (
    SELECT 
      us.user_id,
      us.is_elite,
      CASE 
        WHEN us.given_24h > 0 AND (us.recv_24h::FLOAT / us.given_24h) >= 0.9 THEN true 
        ELSE false 
      END as is_slowdown
    FROM user_stats us
    WHERE us.is_elite = true 
       OR (EXTRACT(EPOCH FROM (NOW() - us.profile_created_at)) < 86400 AND us.recv_total < p_active_like_count)
       OR (us.active_likes >= p_active_like_count AND NOT (us.given_24h > 0 AND us.recv_24h >= us.given_24h))
  ),
  ranked_links AS (
    SELECT 
      el.id,
      el.url,
      el.likes_count,
      el.user_id,
      el.created_at,
      eu.is_elite,
      eu.is_slowdown,
      MAX(el.created_at) OVER(PARTITION BY el.user_id) as max_created_at,
      ROW_NUMBER() OVER(PARTITION BY el.user_id ORDER BY el.created_at DESC) as rank_in_user
    FROM eligible_links el
    JOIN eligible_users eu ON eu.user_id = el.user_id
  )
  SELECT 
    rl.id,
    rl.url,
    rl.likes_count,
    rl.is_elite as anonymous,
    false as is_boosted
  FROM ranked_links rl
  ORDER BY 
    rl.is_elite DESC, 
    CASE WHEN rl.is_elite THEN rl.created_at ELSE NULL END DESC,
    rl.rank_in_user ASC, 
    rl.is_slowdown ASC, 
    rl.max_created_at DESC, 
    rl.user_id DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
