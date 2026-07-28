import "server-only";
import { LINK_COOLDOWN_HOURS } from "@/lib/types";
import { getSettings } from "@/lib/settings";
import { supabase } from "@/lib/supabase";

export type FeedLinkRow = {
  id: string;
  url: string;
  likesCount: number;
  anonymous: boolean;
  isBoosted?: boolean;
};

export async function getFeed(
  viewerId: string,
  offset = 0,
  limit = 50,
): Promise<{ links: FeedLinkRow[]; nextOffset: number }> {
  const settings = await getSettings();

  const { data: links, error } = await supabase.rpc("get_eligible_feed_links", {
    viewer_id: viewerId,
    p_active_like_count: settings.activeLikeCount,
    p_active_window_hours: settings.activeWindowHours,
    p_cooldown_hours: LINK_COOLDOWN_HOURS,
    p_limit: limit,
    p_offset: offset,
  });

  if (error || !links) {
    console.error("[feed] get_eligible_feed_links error:", error?.message);
    return { links: [], nextOffset: offset };
  }

  const formattedLinks: FeedLinkRow[] = links.map((l: any) => ({
    id: l.id,
    url: l.url,
    likesCount: l.likes_count,
    anonymous: l.anonymous,
    isBoosted: l.is_boosted,
  }));

  return { links: formattedLinks, nextOffset: offset + formattedLinks.length };
}
