-- =============================================================================
-- 0005_phase3_hardening.sql
-- Phase 3 fixes from the security audit (like-commit / feed hardening).
--
-- Run this ONCE, AFTER 0003_security_hardening.sql and 0004_phase2_hardening.sql,
-- in the Supabase Dashboard -> SQL Editor (or via CLI migrate). Renamed from
-- 0004 to 0005 to resolve a filename collision with 0004_phase2_hardening.sql
-- (written concurrently by a different pass) — no functional change.
-- SAFE TO RE-RUN: every statement is idempotent (DROP ... IF EXISTS /
-- CREATE OR REPLACE / IF NOT EXISTS).
--
-- Builds on top of 0003's process_like_commit (per-(liker,link) advisory
-- lock, taken as the very first statement) — that lock is PRESERVED below,
-- unchanged, as the first statement in the function body. Do not remove it.
-- =============================================================================


-- ===========================================================================
-- FIX 2 (Phase 3) — owner exposure/deficit check is non-atomic
-- ===========================================================================
-- src/app/actions/like.ts's commitLikeAction reads ownerRecvTotal / given24 /
-- recv24 via separate SELECTs and only then decides whether the owner's
-- "deficit" gate blocks the like. That read-then-decide sequence races
-- against concurrent commits for the SAME owner (receiver) from DIFFERENT
-- likers — 0003's advisory lock is keyed per (liker_id, link_id) and does
-- NOT serialize two different likers hitting the same receiver at once.
--
-- Fix: take a second, receiver-scoped advisory lock right after 0003's
-- liker+link lock, then re-run the exact same deficit computation inside the
-- function, under that lock, before the like is inserted. This is now the
-- authoritative, race-free check. The TypeScript layer keeps its own copy of
-- this check as an early-exit for the common (non-racing) case — see
-- src/app/actions/like.ts step 4 — but only the version below is guaranteed
-- correct under concurrency.
--
-- Return-value note: process_like_commit's signature stays RETURNS BOOLEAN
-- (adding a distinguishable error-reason return would be a bigger interface
-- change than this pass warrants). The function already returns FALSE for
-- "12h cooldown active"; it now also returns FALSE for "owner deficit/
-- exposure limit reached". The TypeScript caller only ever sees this second
-- reason in the narrow race window the lock exists to close (the common
-- case is already caught by the TS-side early-exit, which reports
-- "exposure_limit_reached" precisely) — see like.ts's comment at the
-- `!rpcResult` check for the reasoning.
--
-- New parameters p_active_window_hours / p_active_like_count carry the
-- settings values the deficit computation needs (mirroring
-- settings.active_window_hours / settings.active_like_count in
-- src/app/actions/like.ts) since the function had no access to app settings
-- before.
--
-- ===========================================================================
-- FIX 3 (Phase 3) — boosted quota drained by organic (non-boosted-feed) likes
-- ===========================================================================
-- The boost_used-decrement and boosted_offer_count crediting were gated only
-- on `v_owner_profile.is_boosted AND NOT is_elite`, ignoring
-- p_is_boosted_like (whether THIS SPECIFIC like actually came from the
-- boosted-feed placement, computed in like.ts as
-- `source === "boosted" && owner.is_boosted && !owner.is_elite`). Combined
-- with the normal feed not excluding boosted owners' links, a like via the
-- plain feed on a boosted owner's link drained their paid boost quota and
-- let the liker farm the "boosted offer" reward without ever visiting the
-- boosted feed.
--
-- Fix: require p_is_boosted_like too for the quota-decrement/offer-credit
-- block. This is NOT redundant with the TS-side `isActuallyBoosted`
-- computation even though that computation already ANDs in `owner.is_boosted
-- && !owner.is_elite` — combining p_is_boosted_like with a FRESH read of
-- v_owner_profile.is_boosted / is_elite here guards against the owner's
-- boosted/elite status changing between like.ts's read (used to compute
-- p_is_boosted_like) and this function's execution, same class of TOCTOU
-- this whole migration is about. The lazy boost-time-expiry cleanup
-- (boost_model = 'time' AND boost_expiry < now) is intentionally left
-- ungated by p_is_boosted_like — it's a housekeeping check independent of
-- who liked, not a usage counter tied to this specific like event, so it
-- should still fire on any like toward a boosted owner, not only
-- boosted-feed-sourced ones.

DROP FUNCTION IF EXISTS public.process_like_commit(uuid, uuid, uuid, boolean, boolean, boolean, int, int);

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
  -- 0a. Serialize concurrent calls for the same (liker, link) pair (Phase 1,
  --     preserved unchanged from 0003 — do not remove).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_liker_id::text || ':' || p_link_id::text, 0));

  -- 0b. Serialize concurrent calls toward the same RECEIVER (Phase 3, Fix 2)
  --     so the exposure/deficit check below can't race against a different
  --     liker's concurrent commit to the same owner. Distinct salt (1) from
  --     the pair lock above (0) so the two locks occupy separate key spaces.
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

  -- 2. Owner exposure/deficit check (Phase 3, Fix 2) — authoritative,
  --    race-free version of src/app/actions/like.ts step 4, now running
  --    under the receiver lock taken above. Load the owner profile once
  --    here and reuse it below (step 5) instead of re-selecting it.
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

  -- 6b. Boost usage-quota decrement + boosted-offer crediting (Phase 3,
  --     Fix 3) — now ALSO requires p_is_boosted_like, so an organic
  --     (non-boosted-feed) like on a boosted owner's link no longer drains
  --     their paid boost quota or lets the liker farm the boosted-offer
  --     reward.
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
        v_current_until := COALESCE(v_liker_profile.free_autolike_until, v_now);
        IF v_current_until < v_now THEN
          v_current_until := v_now;
        END IF;

        UPDATE profiles
        SET boosted_offer_count = 0,
            free_autolike_until = v_current_until + (p_offer_autolike_minutes || ' minutes')::INTERVAL,
            auto_like_paused = false,
            auto_like_paused_remaining_minutes = null,
            free_autolike_paused_remaining_minutes = null
        WHERE id = p_liker_id;
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
