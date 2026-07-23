-- =============================================================================
-- 0003_security_hardening.sql
-- Phase 1 fixes from the security audit (database layer).
--
-- Run this ONCE in the Supabase Dashboard → SQL Editor (or via CLI migrate).
-- SAFE TO RE-RUN: every statement is idempotent (DROP ... IF EXISTS /
-- CREATE OR REPLACE / IF NOT EXISTS).
-- =============================================================================


-- ===========================================================================
-- FIX 1 — profiles RLS update policy allows self privilege-escalation
-- ===========================================================================
-- `profiles_update_own` (supabase/setup.sql) only checks `auth.uid() = id`,
-- with no column restriction. Any authenticated user could otherwise call
--   supabase.from('profiles').update({ role: 'super_admin', is_elite: true })
-- directly via the anon/authenticated PostgREST path and have it succeed.
--
-- The app's own server actions (src/app/actions/profile.ts `updateProfile`)
-- only ever let a user self-edit first_name / last_name / phone, and they go
-- through the SERVICE-ROLE client (`@/lib/supabase`), which bypasses RLS but
-- NOT triggers. Password changes go through Supabase Auth's own
-- `auth.updateUser()`, never a `profiles` row update.
--
-- This BEFORE UPDATE trigger is a deny-by-default guard on the anon/
-- authenticated-key path: service-role writes are always allowed (so every
-- existing admin / super-admin / RPC flow keeps working); anything else may
-- only touch the {first_name, last_name, phone} allowlist. A newly added
-- column is protected automatically because everything not explicitly
-- allowlisted is blocked.

create or replace function public.enforce_profiles_self_update_allowlist()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Server-side / admin / RPC flows all use the service-role client, which
  -- PostgREST executes as the `service_role` Postgres role. Trust it fully —
  -- this is the only path allowed to touch privileged columns.
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Anon/authenticated-key path (a direct API/devtools call, since the app
  -- itself never updates profiles this way): only first_name, last_name,
  -- phone may change. Every other column on public.profiles is listed below
  -- explicitly — if ANY of them differ between OLD and NEW, reject the
  -- update outright.
  if new.id                                      is distinct from old.id
     or new.public_id                            is distinct from old.public_id
     or new.email                                is distinct from old.email
     or new.role                                 is distinct from old.role
     or new.status                               is distinct from old.status
     or new.is_elite                             is distinct from old.is_elite
     or new.is_boosted                           is distinct from old.is_boosted
     or new.boost_order                          is distinct from old.boost_order
     or new.boost_model                          is distinct from old.boost_model
     or new.boost_expiry                         is distinct from old.boost_expiry
     or new.boost_quota                          is distinct from old.boost_quota
     or new.boost_used                           is distinct from old.boost_used
     or new.auto_like_enabled                    is distinct from old.auto_like_enabled
     or new.auto_like_model                      is distinct from old.auto_like_model
     or new.auto_like_expiry                     is distinct from old.auto_like_expiry
     or new.auto_like_quota                      is distinct from old.auto_like_quota
     or new.auto_like_used                       is distinct from old.auto_like_used
     or new.free_autolike_until                  is distinct from old.free_autolike_until
     or new.auto_like_paused                     is distinct from old.auto_like_paused
     or new.auto_like_paused_remaining_minutes   is distinct from old.auto_like_paused_remaining_minutes
     or new.free_autolike_paused_remaining_minutes is distinct from old.free_autolike_paused_remaining_minutes
     or new.boosted_offer_count                  is distinct from old.boosted_offer_count
     or new.referred_by                          is distinct from old.referred_by
     or new.approved_by                          is distinct from old.approved_by
     or new.created_at                           is distinct from old.created_at
  then
    raise exception
      'profiles: self-service updates may only change first_name, last_name, phone';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_restrict_self_update on public.profiles;
create trigger profiles_restrict_self_update
  before update on public.profiles
  for each row execute function public.enforce_profiles_self_update_allowlist();


-- ===========================================================================
-- FIX 2 — process_like_commit TOCTOU race (cooldown bypass / double-like)
-- ===========================================================================
-- The function did an unconditional COUNT(*) cooldown check followed by an
-- unconditional INSERT, with no lock. Two concurrent calls for the same
-- (liker, link) pair could both pass the cooldown check before either INSERT
-- committed, producing a double-like inside the 12h window.
--
-- Fix: take a transaction-scoped advisory lock keyed on (liker_id, link_id)
-- as the very first statement in the function body. A second concurrent call
-- for the same pair blocks until the first transaction commits/rolls back,
-- closing the race without a permanent unique constraint (which would wrongly
-- block legitimate re-likes once the cooldown has expired).

CREATE OR REPLACE FUNCTION public.process_like_commit(
  p_liker_id UUID,
  p_link_id UUID,
  p_receiver_id UUID,
  p_is_anon BOOLEAN,
  p_is_boosted_like BOOLEAN,
  p_offer_active BOOLEAN,
  p_offer_likes_required INT,
  p_offer_autolike_minutes INT
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
BEGIN
  -- 0. Serialize concurrent calls for the same (liker, link) pair so the
  --    cooldown check below can't race with itself.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_liker_id::text || ':' || p_link_id::text, 0));

  -- 1. Check 12h cooldown
  SELECT COUNT(*) INTO v_recent_like_count
  FROM likes
  WHERE liker_id = p_liker_id
    AND link_id = p_link_id
    AND created_at >= (v_now - INTERVAL '12 hours');

  IF v_recent_like_count > 0 THEN
    RETURN FALSE; -- Cooldown active
  END IF;

  -- 2. Insert the like
  INSERT INTO likes (id, liker_id, link_id, receiver_id, is_anonymous, is_boosted_like, created_at)
  VALUES (gen_random_uuid(), p_liker_id, p_link_id, p_receiver_id, p_is_anon, p_is_boosted_like, v_now);

  -- 3. Increment link likes_count
  UPDATE links
  SET likes_count = COALESCE(likes_count, 0) + 1
  WHERE id = p_link_id;

  -- 4. Process Liker Usage (Auto-like)
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

  -- 5. Process Owner Usage (Boosted page)
  SELECT * INTO v_owner_profile FROM profiles WHERE id = p_receiver_id;

  IF v_owner_profile.is_boosted AND NOT COALESCE(v_owner_profile.is_elite, false) THEN
    -- Check Time expiry
    IF v_owner_profile.boost_model = 'time' AND v_owner_profile.boost_expiry < v_now THEN
      UPDATE profiles
      SET is_boosted = false,
          boost_model = 'none',
          boost_expiry = null,
          boost_order = null
      WHERE id = p_receiver_id;
    END IF;

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


-- ===========================================================================
-- FIX 3 — RPC functions had no EXECUTE restriction (callable via PostgREST)
-- ===========================================================================
-- None of these functions had REVOKE/GRANT statements, so Postgres's default
-- grants left them callable by `anon`/`authenticated` directly via
-- `/rest/v1/rpc/*` — bypassing the app's ad-view-token verification,
-- burst-cap, and exposure checks, which live only in the TypeScript layer.
--
-- Verified every `.rpc(...)` call site in src/ (like.ts, stats.ts, feed.ts)
-- imports `supabase` from `@/lib/supabase`, which re-exports the service-role
-- `supabaseAdmin` client — never an anon/browser client — so restricting
-- EXECUTE to `service_role` does not break any existing call site.

REVOKE EXECUTE ON FUNCTION public.process_like_commit(uuid, uuid, uuid, boolean, boolean, boolean, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_like_commit(uuid, uuid, uuid, boolean, boolean, boolean, int, int) TO service_role;

REVOKE EXECUTE ON FUNCTION public.increment_link_likes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_link_likes(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.increment_profile_usage(uuid, int, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_profile_usage(uuid, int, int, int) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_feed_user_stats(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_feed_user_stats(timestamptz, timestamptz) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_my_stats(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_stats(uuid, timestamptz, timestamptz) TO service_role;


-- ===========================================================================
-- FIX 4 — no audit log for privileged admin/super-admin actions
-- ===========================================================================
-- Table only, for now. Phase 2 (a separate pass on src/app/actions/admin.ts
-- and super-admin.ts) will add the actual `INSERT INTO audit_log` calls.
-- No insert/select policy for anon/authenticated by design — only
-- service-role (server actions) can write, mirroring the `likes` table's
-- pattern for privileged writes; staff can read via the policy below.

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_role  text,
  action      text not null,
  target_id   uuid,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id);

alter table public.audit_log enable row level security;

drop policy if exists "audit_log_staff_read" on public.audit_log;
create policy "audit_log_staff_read" on public.audit_log
  for select using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'super_admin')
    )
  );

-- =============================================================================
-- End of migration.
-- =============================================================================
