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

function hoursAgoISO(h: number): string {
  return new Date(Date.now() - h * 3600000).toISOString();
}

async function fetchAll<T>(
  queryFn: (from: number, to: number) => Promise<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const allData: T[] = [];
  let from = 0;
  const size = 1000;
  while (true) {
    const { data, error } = await queryFn(from, from + size - 1);
    if (error || !data || data.length === 0) break;
    allData.push(...data);
    if (data.length < size) break;
    from += size;
  }
  return allData;
}

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

export type BoostedFeedResult = {
  links: FeedLinkRow[];
  nextOffset: number;
  offer: { required: number; minutes: number; progress: number; active: boolean };
};

export async function getBoostedFeed(
  viewerId: string,
  offerProgress: number,
  offset = 0,
  limit = 50,
): Promise<BoostedFeedResult> {
  const settings = await getSettings();

  const cooldownIso = hoursAgoISO(LINK_COOLDOWN_HOURS);

  const cooldownLinks = await fetchAll(async (from, to) =>
    await supabase
      .from("likes")
      .select("link_id")
      .eq("liker_id", viewerId)
      .gte("created_at", cooldownIso)
      .range(from, to)
  );

  const cooldownSet = new Set(cooldownLinks.map((l: any) => l.link_id));

  const boosted = await fetchAll(async (from, to) =>
    await supabase
      .from("profiles")
      .select("id, boost_order")
      .eq("is_boosted", true)
      .eq("is_elite", false)
      .neq("id", viewerId)
      .eq("status", "approved")
      .range(from, to)
  );

  if (boosted.length === 0) {
    return {
      links: [],
      nextOffset: offset,
      offer: {
        required: settings.offerLikesRequired,
        minutes: settings.offerAutoLikeMinutes,
        progress: offerProgress,
        active: settings.offerActive,
      },
    };
  }

  const boostedOwnerIds = boosted.map((p) => p.id);
  const boostOrderMap = new Map(
    boosted.map((p) => [p.id, p.boost_order ?? Number.MAX_SAFE_INTEGER]),
  );

  const chunkedBoostedLinks: {
    id: string;
    url: string;
    likes_count: number;
    user_id: string;
  }[] = [];
  const chunkSizeBoosted = 90;
  for (let i = 0; i < boostedOwnerIds.length; i += chunkSizeBoosted) {
    const chunk = boostedOwnerIds.slice(i, i + chunkSizeBoosted);
    const { data: links } = await supabase
      .from("links")
      .select("id, url, likes_count, user_id")
      .in("user_id", chunk)
      .gte("sort_order", 0);

    if (links) {
      chunkedBoostedLinks.push(...links);
    }
  }
  const rawLinks = chunkedBoostedLinks;

  const filtered = rawLinks.filter(
    (l) => l.user_id !== viewerId && !cooldownSet.has(l.id),
  );
  filtered.sort(
    (a, b) =>
      (boostOrderMap.get(a.user_id) ?? Number.MAX_SAFE_INTEGER) -
      (boostOrderMap.get(b.user_id) ?? Number.MAX_SAFE_INTEGER),
  );

  const page = filtered.slice(offset, offset + limit);
  const links: FeedLinkRow[] = page.map((l) => ({
    id: l.id,
    url: l.url,
    likesCount: l.likes_count,
    anonymous: false,
    isBoosted: true,
  }));

  return {
    links,
    nextOffset: offset + links.length,
    offer: {
      required: settings.offerLikesRequired,
      minutes: settings.offerAutoLikeMinutes,
      progress: offerProgress,
      active: settings.offerActive,
    },
  };
}
