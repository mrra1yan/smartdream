-- =============================================================================
--  CLEANUP: remove broken auth users created by the fragile SQL seed.
-- =============================================================================
--  The earlier raw INSERT into auth.users left rows without matching entries
--  in auth.identities, which makes listUsers fail with:
--    "Database error finding users" (HTTP 500).
--
--  This script deletes ONLY the demo users (by email), so we can recreate
--  them cleanly via the Admin API script (scripts/seed-users.mjs).
--
--  Run in: Supabase Dashboard → SQL Editor → Run.
--  Safe to re-run.
-- =============================================================================

-- 1. Remove the dangling profiles rows for demo users.
delete from public.profiles
  where email in (
    'superadmin@smartdream.app',
    'admin@smartdream.app',
    'elite@smartdream.app',
    'user1@smartdream.app',
    'user2@smartdream.app'
  );

-- 2. Remove the broken auth.users rows. The ON DELETE CASCADE on
--    profiles.id_fkey already handled profiles; this cleans the auth side.
--    Also clear any orphaned identities/audit entries for these emails.
delete from auth.identities
  where identity_data->>'email' in (
    'superadmin@smartdream.app',
    'admin@smartdream.app',
    'elite@smartdream.app',
    'user1@smartdream.app',
    'user2@smartdream.app'
  );

delete from auth.users
  where email in (
    'superadmin@smartdream.app',
    'admin@smartdream.app',
    'elite@smartdream.app',
    'user1@smartdream.app',
    'user2@smartdream.app'
  );

-- 3. Verify the cleanup worked (run listUsers again after this from the script).
select 'remaining demo users in auth.users:' as info, count(*) as n
  from auth.users
  where email like '%@smartdream.app';

select 'remaining demo profiles:' as info, count(*) as n
  from public.profiles
  where email like '%@smartdream.app';
