-- 0002_links_sort_order_bigint.sql
-- Fix: links.sort_order was `integer` (max ~2.1B), but deleteLink used
-- `-Date.now()` which is a 13-digit ms timestamp → overflow error 22003.
--
-- This migration widens the column to `bigint` (max ~9.2e18), which safely
-- holds both the legacy negative-ms values and the new negative-seconds values.
--
-- Code side: deleteLink() now writes `-Math.floor(Date.now()/1000)` (seconds),
-- which fits even in `integer`, so this migration is belt-and-suspenders for
-- future-proofing and to clean up any partially-failed rows.
--
-- Safe to re-run. `using ...` drops the implicit index if present so the type
-- change can proceed without conflict.

alter table public.links
  alter column sort_order type bigint
  using sort_order::bigint;

-- Backfill any rows that may have failed to soft-delete due to the old overflow.
-- They still have sort_order >= 0 with the deleted-marker URL; push them negative.
update public.links
  set sort_order = -extract(epoch from now())::bigint
  where url = 'https://deleted.local'
    and sort_order >= 0;
