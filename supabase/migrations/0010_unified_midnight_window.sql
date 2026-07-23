-- =============================================================================
-- 0010_unified_midnight_window.sql
-- Fixes profile column names, free autolike crediting, and rolling 24h deficit.
-- =============================================================================

-- Drop the old 10-param overload so the new 11-param version is the only one.
-- Without this, calling process_like_commit with 10 named args is ambiguous
-- (both the old 10-param and the new 11-param-with-default match) and
-- PostgreSQL throws "function is not unique", silently failing every like.
DROP FUNCTION IF EXISTS public.process_like_commit(
  UUID, UUID, UUID, BOOLEAN, BOOLEAN, BOOLEAN, INT, INT, INT, INT
);

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
        AND is_boosted_like = false
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

REVOKE EXECUTE ON FUNCTION public.process_like_commit(UUID, UUID, UUID, BOOLEAN, BOOLEAN, BOOLEAN, INT, INT, INT, INT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_like_commit(UUID, UUID, UUID, BOOLEAN, BOOLEAN, BOOLEAN, INT, INT, INT, INT, TIMESTAMPTZ) TO service_role;
