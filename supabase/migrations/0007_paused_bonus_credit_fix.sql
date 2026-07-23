-- =============================================================================
-- 0007_paused_bonus_credit_fix.sql
--
-- Run this ONCE, AFTER 0006_low_severity_races.sql, in the Supabase Dashboard
-- -> SQL Editor (or via CLI migrate).
-- SAFE TO RE-RUN: DROP ... IF EXISTS / CREATE OR REPLACE, idempotent.
--
-- Builds on top of 0005's process_like_commit (redefined here since 0006 did
-- not touch it) — the advisory locks, cooldown check, and owner
-- exposure/deficit check are PRESERVED below, unchanged. Only the
-- boosted-offer free-autolike crediting block (step 6b) changes.
-- =============================================================================

-- ===========================================================================
-- FIX — boosted-offer reward force-unpauses the liker and strands any paused
-- paid plan
-- ===========================================================================
-- When a liker's boosted_offer_count reaches p_offer_likes_required, the
-- function grants a free-autolike reward by writing directly to
-- free_autolike_until and force-setting auto_like_paused = false (clearing
-- both *_paused_remaining_minutes snapshots).
--
-- That's correct when the liker isn't currently paused. But a liker can earn
-- offer progress by manually clicking through the boosted feed (LinkCard's
-- onLike doesn't check auto_like_paused at all) while their own auto-like is
-- deliberately paused -- e.g. they paused a paid time-based plan to save its
-- remaining minutes. In that state, free_autolike_until is already null
-- (nulled out at pause time -- see /api/auto-like/status's "pause" handler)
-- and the real remaining time lives in auto_like_paused_remaining_minutes /
-- free_autolike_paused_remaining_minutes instead. The old code:
--   1. wrote the new reward straight to free_autolike_until (irrelevant while
--      paused -- getAutoLikeStatus() ignores free_autolike_until whenever
--      auto_like_paused is true), and
--   2. set auto_like_paused = false and NULLED both remaining-minutes
--      snapshots, permanently discarding whatever paid time the liker had
--      saved by pausing, without ever restoring it to auto_like_expiry.
--
-- The app's own resume() endpoint (src/app/api/auto-like/status/route.ts)
-- never runs in this path, so nothing ever converts the (now-nulled) paid
-- snapshot back into a live auto_like_expiry -- it's just gone.
--
-- Fix: if the liker is currently paused, extend the
-- free_autolike_paused_remaining_minutes snapshot instead of touching
-- free_autolike_until, and leave auto_like_paused / the paid snapshot
-- (auto_like_paused_remaining_minutes) alone. The reward becomes active the
-- moment the liker actually resumes, same as it would have if they'd earned
-- it while not paused. Same fix pattern applied on the TypeScript side for
-- the referral-referrer bonus, see approveUser() in
-- src/app/actions/admin.ts.
-- ===========================================================================

DROP FUNCTION IF EXISTS public.process_like_commit(uuid, uuid, uuid, boolean, boolean, boolean, int, int, int, int);

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
  p_active_like_count INT
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
BEGIN
  -- 0a. Serialize concurrent calls for the same (liker, link) pair.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_liker_id::text || ':' || p_link_id::text, 0));

  -- 0b. Serialize concurrent calls toward the same RECEIVER.
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

  -- 2. Owner exposure/deficit check.
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
      SELECT COUNT(*) INTO v_owner_given_24h
      FROM likes
      WHERE liker_id = p_receiver_id
        AND is_boosted_like = false
        AND created_at >= (v_now - (p_active_window_hours || ' hours')::INTERVAL);

      SELECT COUNT(*) INTO v_owner_recv_24h
      FROM likes
      WHERE receiver_id = p_receiver_id
        AND is_boosted_like = false
        AND created_at >= (v_now - (p_active_window_hours || ' hours')::INTERVAL);

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

  -- 6. Process Owner Usage (Boosted page). v_owner_profile was already
  --    loaded in step 2 above — reuse that snapshot instead of re-selecting.

  -- 6a. Lazy boost-expiry cleanup: independent of which specific like
  --     triggered it, so intentionally NOT gated on p_is_boosted_like.
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

  -- 6b. Boost usage-quota decrement + boosted-offer crediting (requires
  --     p_is_boosted_like, so an organic (non-boosted-feed) like on a
  --     boosted owner's link doesn't drain their paid boost quota or let the
  --     liker farm the boosted-offer reward).
  IF v_owner_profile.is_boosted AND p_is_boosted_like AND NOT COALESCE(v_owner_profile.is_elite, false) THEN
    -- Check Usage quota
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
      -- Just increment usage if not capped by usage
      UPDATE profiles
      SET boost_used = COALESCE(boost_used, 0) + 1
      WHERE id = p_receiver_id;
    END IF;

    -- Process Offer (Free autolike for viewers)
    IF p_offer_active THEN
      v_new_offer_count := COALESCE(v_liker_profile.boosted_offer_count, 0) + 1;

      IF v_new_offer_count >= p_offer_likes_required THEN
        IF COALESCE(v_liker_profile.auto_like_paused, false) THEN
          -- Liker is currently paused: extend the paused-state snapshot
          -- instead of free_autolike_until (which is null while paused and
          -- would be silently ignored/overwritten the moment they resume via
          -- the app's own resume() endpoint, which recomputes
          -- free_autolike_until purely from this snapshot). Leave
          -- auto_like_paused and auto_like_paused_remaining_minutes alone —
          -- a deliberate pause shouldn't be force-reactivated by an
          -- unrelated boosted-offer reward, and clearing the paid snapshot
          -- here would strand any paid time-based plan the liker paused
          -- earlier.
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

REVOKE EXECUTE ON FUNCTION public.process_like_commit(uuid, uuid, uuid, boolean, boolean, boolean, int, int, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_like_commit(uuid, uuid, uuid, boolean, boolean, boolean, int, int, int, int) TO service_role;

-- =============================================================================
-- End of migration.
-- =============================================================================
