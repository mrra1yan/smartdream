-- Speed up likes COUNTs used by process_like_commit, feed cooldown, and stats.
-- These indexes existed only in supabase_rpc.sql and were never migrated.

CREATE INDEX IF NOT EXISTS idx_likes_liker_created_at
  ON public.likes (liker_id, created_at);

CREATE INDEX IF NOT EXISTS idx_likes_receiver_created_at
  ON public.likes (receiver_id, created_at);

CREATE INDEX IF NOT EXISTS idx_likes_receiver_organic
  ON public.likes (receiver_id, created_at)
  WHERE is_boosted_like IS DISTINCT FROM true;

CREATE INDEX IF NOT EXISTS idx_likes_liker_link_created
  ON public.likes (liker_id, link_id, created_at);
