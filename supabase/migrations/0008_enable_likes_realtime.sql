-- =============================================================================
-- 0008_enable_likes_realtime.sql
--
-- Run this ONCE, AFTER 0007_paused_bonus_credit_fix.sql, in the Supabase
-- Dashboard -> SQL Editor (or via CLI migrate).
-- SAFE TO RE-RUN: guarded by an existence check, idempotent.
-- =============================================================================

-- ===========================================================================
-- FIX — home/given-likes counter stopped updating live, needs a page reload
-- ===========================================================================
-- src/components/home-stats-client.tsx subscribes to Postgres Realtime
-- (`postgres_changes` on INSERT) for the `likes` table to increment the
-- given/received counters without a reload. That subscription only ever
-- receives events for tables added to the `supabase_realtime` publication --
-- this is normally toggled in Database > Replication in the dashboard, not
-- something any prior migration in this repo set up in SQL, so it's not
-- durable across a table/publication recreation or project restore.
--
-- The RLS policy that gates which rows a client is even allowed to receive
-- (`likes_select_own_or_public`, see 0001_supabase_auth.sql) is unaffected
-- by this and already correctly scopes it to the user's own likes; this
-- migration only restores/codifies the publication membership itself.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'likes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.likes;
  END IF;
END $$;

-- =============================================================================
-- End of migration.
-- =============================================================================
