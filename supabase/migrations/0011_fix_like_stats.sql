-- =============================================================================
-- 0011_fix_like_stats.sql
-- Fixes user stats counts (given_24h) to include likes given to boosted profiles.
-- Also fixes deficit exposure window bug in process_like_commit.
-- =============================================================================

-- 1. Fix get_feed_user_stats to include boosted likes in given stats
CREATE OR REPLACE FUNCTION get_feed_user_stats(
  window_iso TIMESTAMPTZ,
  minus24h_iso TIMESTAMPTZ
)
RETURNS TABLE (
  profile_id UUID,
  created_at TIMESTAMPTZ,
  is_elite BOOLEAN,
  active_likes BIGINT,
  given_24h BIGINT,
  recv_24h BIGINT,
  recv_total BIGINT
)
LANGUAGE sql
AS $$
  WITH given_stats AS (
    SELECT
      liker_id,
      COUNT(*) FILTER (WHERE created_at >= window_iso) as active_likes,
      COUNT(*) FILTER (WHERE created_at >= minus24h_iso) as given_24h
    FROM likes
    GROUP BY liker_id
  ),
  recv_stats AS (
    SELECT
      receiver_id,
      COUNT(*) FILTER (WHERE created_at >= minus24h_iso) as recv_24h,
      COUNT(*) as recv_total
    FROM likes
    WHERE is_boosted_like IS DISTINCT FROM true
    GROUP BY receiver_id
  )
  SELECT
    p.id as profile_id,
    p.created_at,
    p.is_elite,
    COALESCE(g.active_likes, 0) as active_likes,
    COALESCE(g.given_24h, 0) as given_24h,
    COALESCE(r.recv_24h, 0) as recv_24h,
    COALESCE(r.recv_total, 0) as recv_total
  FROM profiles p
  LEFT JOIN given_stats g ON p.id = g.liker_id
  LEFT JOIN recv_stats r ON p.id = r.receiver_id;
$$;

-- 2. Fix get_my_stats to include boosted likes in given stats
CREATE OR REPLACE FUNCTION get_my_stats(
  viewer_id UUID,
  today_iso TIMESTAMPTZ,
  minus24h_iso TIMESTAMPTZ
)
RETURNS TABLE (
  given_today BIGINT,
  received_today BIGINT,
  given_24h BIGINT,
  received_24h BIGINT
)
LANGUAGE sql
AS $$
  SELECT
    (SELECT COUNT(*) FROM likes WHERE liker_id = viewer_id AND created_at >= today_iso) as given_today,
    (SELECT COUNT(*) FROM likes WHERE receiver_id = viewer_id AND created_at >= today_iso AND is_boosted_like IS DISTINCT FROM true) as received_today,
    (SELECT COUNT(*) FROM likes WHERE liker_id = viewer_id AND created_at >= minus24h_iso) as given_24h,
    (SELECT COUNT(*) FROM likes WHERE receiver_id = viewer_id AND created_at >= minus24h_iso AND is_boosted_like IS DISTINCT FROM true) as received_24h;
$$;

-- 3. Fix process_like_commit to include boosted likes when checking owner deficit
CREATE OR REPLACE FUNCTION public.process_like_commit(
  p_liker_id UUID,
  p_link_id UUID,
  p_receiver_id UUID,
  p_is_anon BOOLEAN,
  p_is_boosted_like BOOLEAN,
  p_offer_active BOOLEAN,
  p_offer_likes_required INT,
  p_offer_autolike_minutes INT,
  p_active_window_hours INT,
  p_active_like_count INT,
  p_today_iso TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_recent_like_count INT;
  v_liker_profile RECORD;
  v_owner_profile RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_new_offer_count INT;
  v_current_until TIMESTAMPTZ;
  v_owner_recv_total INT;
  v_is_owner_new_user BOOLEAN;
  v_owner_given_24h INT;
  v_owner_recv_24h INT;
  v_window_start TIMESTAMPTZ;
BEGIN
  -- 0a. Serialize concurrent calls for the same (liker, link) pair
  PERFORM pg_advisory_xact_lock(hashtextextended(p_liker_id::text || ':' || p_link_id::text, 0));

  -- 0b. Serialize concurrent calls toward the same RECEIVER
  PERFORM pg_advisory_xact_lock(hashtextextended(p_receiver_id::text, 1));

  -- 1. Check 12h cooldown
  SELECT COUNT(*) INTO v_recent_like_count
  FROM likes
  WHERE liker_id = p_liker_id
    AND link_id = p_link_id
    AND created_at >= (v_now - INTERVAL '12 hours');

  IF v_recent_like_count > 0 THEN
    RETURN FALSE; -- Cooldown active
  END IF;

  -- 2. Owner exposure/deficit check (using rolling window to prevent midnight dropouts)
  SELECT * INTO v_owner_profile FROM profiles WHERE id = p_receiver_id;
  IF v_owner_profile IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT (COALESCE(v_owner_profile.is_elite, false) OR COALESCE(v_owner_profile.is_boosted, false)) THEN
    SELECT COUNT(*) INTO v_owner_recv_total
    FROM likes
    WHERE receiver_id = p_receiver_id
      AND is_boosted_like = false;

    v_is_owner_new_user :=
      (v_now - v_owner_profile.created_at < INTERVAL '24 hours')
      AND (COALESCE(v_owner_recv_total, 0) < p_active_like_count);

    IF NOT v_is_owner_new_user THEN
      v_window_start := v_now - (p_active_window_hours || ' hours')::INTERVAL;

      SELECT COUNT(*) INTO v_owner_given_24h
      FROM likes
      WHERE liker_id = p_receiver_id
        AND created_at >= v_window_start;

      SELECT COUNT(*) INTO v_owner_recv_24h
      FROM likes
      WHERE receiver_id = p_receiver_id
        AND is_boosted_like = false
        AND created_at >= v_window_start;

      IF COALESCE(v_owner_recv_24h, 0) > COALESCE(v_owner_given_24h, 0) THEN
        RETURN FALSE; -- exposure_limit_reached (owner deficit)
      END IF;
    END IF;
  END IF;

  -- 3. Insert the like
  INSERT INTO likes (id, liker_id, link_id, receiver_id, is_anonymous, is_boosted_like, created_at)
  VALUES (gen_random_uuid(), p_liker_id, p_link_id, p_receiver_id, p_is_anon, p_is_boosted_like, v_now);

  -- 4. Increment link likes_count
  UPDATE links
  SET likes_count = COALESCE(likes_count, 0) + 1
  WHERE id = p_link_id;

  -- 5. Process Liker Usage (Auto-like)
  SELECT * INTO v_liker_profile FROM profiles WHERE id = p_liker_id;

  IF v_liker_profile.auto_like_enabled AND NOT COALESCE(v_liker_profile.auto_like_paused, false) THEN
    IF v_liker_profile.auto_like_model = 'time' AND v_liker_profile.auto_like_expiry < v_now THEN
      UPDATE profiles
      SET auto_like_enabled = false,
          auto_like_model = 'none',
          auto_like_expiry = null
      WHERE id = p_liker_id;
    ELSIF v_liker_profile.auto_like_model = 'usage' AND v_liker_profile.auto_like_quota IS NOT NULL THEN
      IF (COALESCE(v_liker_profile.auto_like_used, 0) + 1) >= v_liker_profile.auto_like_quota THEN
        UPDATE profiles
        SET auto_like_used = COALESCE(auto_like_used, 0) + 1,
            auto_like_enabled = false,
            auto_like_model = 'none',
            auto_like_quota = null
        WHERE id = p_liker_id;
      ELSE
        UPDATE profiles
        SET auto_like_used = COALESCE(auto_like_used, 0) + 1
        WHERE id = p_liker_id;
      END IF;
    END IF;
  END IF;

  -- 6. Process Owner Usage (Boosted page)
  IF v_owner_profile.is_boosted AND NOT COALESCE(v_owner_profile.is_elite, false) THEN
    IF v_owner_profile.boost_model = 'time' AND v_owner_profile.boost_expiry < v_now THEN
      UPDATE profiles
      SET is_boosted = false,
          boost_model = 'none',
          boost_expiry = null,
          boost_order = null
      WHERE id = p_receiver_id;
    END IF;
  END IF;

  IF v_owner_profile.is_boosted AND p_is_boosted_like AND NOT COALESCE(v_owner_profile.is_elite, false) THEN
    IF v_owner_profile.boost_model = 'usage' AND v_owner_profile.boost_quota IS NOT NULL THEN
      IF (COALESCE(v_owner_profile.boost_used, 0) + 1) >= v_owner_profile.boost_quota THEN
        UPDATE profiles
        SET boost_used = COALESCE(boost_used, 0) + 1,
            is_boosted = false,
            boost_model = 'none',
            boost_quota = null
        WHERE id = p_receiver_id;
      ELSE
        UPDATE profiles
        SET boost_used = COALESCE(boost_used, 0) + 1
        WHERE id = p_receiver_id;
      END IF;
    ELSE
      UPDATE profiles
      SET boost_used = COALESCE(boost_used, 0) + 1
      WHERE id = p_receiver_id;
    END IF;

    -- Process Offer (Free autolike for viewers)
    IF p_offer_active THEN
      v_new_offer_count := COALESCE(v_liker_profile.boosted_offer_count, 0) + 1;

      IF v_new_offer_count >= p_offer_likes_required THEN
        IF COALESCE(v_liker_profile.auto_like_paused, false) THEN
          UPDATE profiles
          SET boosted_offer_count = 0,
              free_autolike_paused_remaining_minutes =
                COALESCE(v_liker_profile.free_autolike_paused_remaining_minutes, 0) + p_offer_autolike_minutes
          WHERE id = p_liker_id;
        ELSE
          v_current_until := COALESCE(v_liker_profile.free_autolike_until, v_now);
          IF v_current_until < v_now THEN
            v_current_until := v_now;
          END IF;

          UPDATE profiles
          SET boosted_offer_count = 0,
              free_autolike_until = v_current_until + (p_offer_autolike_minutes || ' minutes')::INTERVAL
          WHERE id = p_liker_id;
        END IF;
      ELSE
        UPDATE profiles
        SET boosted_offer_count = v_new_offer_count
        WHERE id = p_liker_id;
      END IF;
    END IF;
  END IF;

  RETURN TRUE;
END;
$$;
