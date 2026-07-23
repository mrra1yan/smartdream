-- =============================================================================
-- 0004_phase2_hardening.sql
-- Phase 2 fixes from the security audit (database layer).
--
-- Run this ONCE in the Supabase Dashboard → SQL Editor (or via CLI migrate),
-- AFTER 0003_security_hardening.sql.
-- SAFE TO RE-RUN: every statement is idempotent (IF NOT EXISTS / guarded DO
-- blocks / CREATE OR REPLACE), except the one-time sequence seed, which is
-- explicitly guarded to only run the first time the sequence is created (see
-- comment below) so re-running this file can't regress a sequence that has
-- already advanced from real usage.
--
-- Everything else in Phase 2 (login filter-injection fix, cross-portal
-- password oracle, referral-settings authorization gate, audit-log INSERTs,
-- IDOR scope checks, input validation, the approveUser race fix, cookie
-- hardening, and the rate-limit IP header fix) is application-code-only and
-- lives in src/, not here — the `audit_log` table itself already exists from
-- 0003_security_hardening.sql, so Phase 2's audit-log INSERTs need no schema
-- change.
-- =============================================================================


-- ===========================================================================
-- FIX 10 — boost_order count-then-write race (concurrent boost activations
-- can collide on the same boost_order value)
-- ===========================================================================
-- `getNextBoostOrder` (src/app/actions/admin.ts) and `nextBoostOrder`
-- (src/lib/admin.ts) both did `SELECT MAX(boost_order) ... WHERE is_boosted`
-- followed by a separate `UPDATE` from the application layer, with no lock
-- spanning the two. Two concurrent boost activations could both read the
-- same MAX and then both write the same boost_order.
--
-- Fix: back the "next order" value with a real Postgres sequence.
-- `nextval()` is atomic at the DB level regardless of concurrent
-- transactions, so two concurrent callers can never observe/receive the
-- same value — no advisory lock required (and no cross-statement lock would
-- help here anyway, since the order-fetch and the profile UPDATE happen as
-- two separate round-trips from the service-role client).
--
-- The seed guard below only runs the first time this sequence is created,
-- so re-running this migration later (once the sequence has already
-- advanced from real boost activations) can't accidentally rewind it based
-- on whatever profiles happen to be boosted at that moment.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_sequences
    WHERE schemaname = 'public' AND sequencename = 'boost_order_seq'
  ) THEN
    CREATE SEQUENCE public.boost_order_seq;
    -- Seed it to continue from whatever the highest existing boost_order
    -- already is, so newly-assigned orders don't collide with orders
    -- assigned by the old MAX()-based code path before this migration ran.
    PERFORM setval(
      'public.boost_order_seq',
      COALESCE((SELECT MAX(boost_order) FROM public.profiles WHERE is_boosted = true), 0) + 1,
      false
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_boost_order()
RETURNS INT
LANGUAGE sql
AS $$
  SELECT nextval('public.boost_order_seq')::int;
$$;

-- Same EXECUTE-restriction pattern as the RPCs locked down in
-- 0003_security_hardening.sql FIX 3: every `.rpc('next_boost_order')` call
-- site (src/app/actions/admin.ts, src/lib/admin.ts) uses the service-role
-- client, never an anon/browser client, so restricting EXECUTE to
-- service_role doesn't break any existing call site.
REVOKE EXECUTE ON FUNCTION public.next_boost_order() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_boost_order() TO service_role;

-- =============================================================================
-- End of migration.
-- =============================================================================
