-- likes rows are never needed past a short window: process_like_commit's
-- cooldown check only looks back 12h, the feed's reciprocity/slowdown ranking
-- only looks back settings.activeWindowHours (default 24h, admin-adjustable
-- up to 720h -- keep that below 7 days or this retention window will start
-- silently truncating it), and the weekly like chart only ever shows the
-- current Mon-Sun week. Nothing in the app reads a like row once it's more
-- than 7 days old, and links.likes_count is a separate persistent counter
-- (incremented in process_like_commit) that isn't affected by deleting rows
-- here, so the visible like count on a link is untouched. Given/received
-- "Total" stats were removed for the same reason instead of being preserved
-- via a separate counter -- see get_my_stats above.
create extension if not exists pg_cron;

select cron.schedule(
  'cleanup_old_likes',
  '0 20 * * *', -- 20:00 UTC = 02:00 Bangladesh time, low-traffic
  $$delete from public.likes where created_at < now() - interval '7 days'$$
);

-- get_my_stats' given_total/received_total columns are gone (see
-- supabase_rpc.sql) -- CREATE OR REPLACE can't change output columns, so the
-- old 6-column function must be dropped before recreating with 4.
DROP FUNCTION IF EXISTS get_my_stats(UUID, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE FUNCTION get_my_stats(
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
    (SELECT COUNT(*) FROM likes WHERE liker_id = viewer_id AND created_at >= today_iso AND is_boosted_like IS DISTINCT FROM true) as given_today,
    (SELECT COUNT(*) FROM likes WHERE receiver_id = viewer_id AND created_at >= today_iso AND is_boosted_like IS DISTINCT FROM true) as received_today,
    (SELECT COUNT(*) FROM likes WHERE liker_id = viewer_id AND created_at >= minus24h_iso AND is_boosted_like IS DISTINCT FROM true) as given_24h,
    (SELECT COUNT(*) FROM likes WHERE receiver_id = viewer_id AND created_at >= minus24h_iso AND is_boosted_like IS DISTINCT FROM true) as received_24h;
$$;
