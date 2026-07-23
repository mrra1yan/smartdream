-- =============================================================================
-- 0006_low_severity_races.sql
-- Two low-severity count-then-write races from the security audit, left
-- unaddressed by the earlier phases (dropped during task batching).
--
-- Run this ONCE, AFTER 0005_phase3_hardening.sql, in the Supabase Dashboard
-- -> SQL Editor (or via CLI migrate).
-- SAFE TO RE-RUN: every statement is idempotent (DROP ... IF EXISTS /
-- CREATE OR REPLACE / IF NOT EXISTS).
-- =============================================================================


-- ===========================================================================
-- FIX — addLink/addLinks count-then-insert race (MAX_LINKS_PER_USER bypass)
-- ===========================================================================
-- src/app/actions/links.ts did a separate COUNT(*) then INSERT with no lock,
-- so two concurrent addLink/addLinks calls for the same user could both pass
-- the quota check before either INSERT committed, exceeding
-- MAX_LINKS_PER_USER.
--
-- Fix: do the count-check-and-insert inside one RPC call (one Postgres
-- transaction), serialized per-user via an advisory lock, same pattern as
-- process_like_commit's per-(liker,link) lock in 0003. Takes a JSON array of
-- {id, url} rows and inserts only as many as still fit under the cap,
-- returning how many were actually inserted — callers use that count to
-- report "added N, skipped M" without needing their own pre-slice (which is
-- exactly what was racy before).

CREATE OR REPLACE FUNCTION public.add_links_atomic(
  p_user_id UUID,
  p_rows JSONB, -- array of {id: uuid-as-text, url: text}, in desired order
  p_max_links INT
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing  INT;
  v_remaining INT;
  v_next_sort INT;
  v_row       JSONB;
  v_inserted  INT := 0;
BEGIN
  -- Serialize concurrent add-link calls for the same user so the count
  -- below can't race with itself.
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  SELECT COUNT(*) INTO v_existing
  FROM links
  WHERE user_id = p_user_id AND sort_order >= 0;

  v_remaining := GREATEST(p_max_links - v_existing, 0);
  v_next_sort := v_existing;

  IF v_remaining = 0 THEN
    RETURN 0;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    EXIT WHEN v_inserted >= v_remaining;

    INSERT INTO links (id, user_id, url, likes_count, sort_order, created_at)
    VALUES (
      (v_row->>'id')::uuid,
      p_user_id,
      v_row->>'url',
      0,
      v_next_sort,
      NOW()
    );

    v_next_sort := v_next_sort + 1;
    v_inserted  := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_links_atomic(uuid, jsonb, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_links_atomic(uuid, jsonb, int) TO service_role;


-- ===========================================================================
-- FIX — phone number duplicate race (no unique constraint)
-- ===========================================================================
-- src/app/actions/profile.ts checked for an existing row with the same phone
-- then updated separately, with no unique constraint backing it — two
-- concurrent updateProfile calls with the same phone could both pass the
-- check and both succeed.
--
-- Fix: a partial unique index (NULL/empty phones excluded, since not every
-- profile has one set) as the authoritative guard. The app-level check stays
-- as a fast, friendly early-exit for the common case; this index is what
-- actually closes the race — a concurrent duplicate now fails with a real
-- unique-violation (23505) that the app catches and reports the same way.

CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_unique_idx
  ON public.profiles (phone)
  WHERE phone IS NOT NULL AND phone <> '';

-- =============================================================================
-- End of migration.
-- =============================================================================
