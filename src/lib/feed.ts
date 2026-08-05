import "server-only";
import { LINK_COOLDOWN_HOURS } from "@/lib/types";
import { getSettings } from "@/lib/settings";
import { getEligibleFeedLinks } from "@/lib/repos/rpc";
import { cacheGet, cacheSet } from "@/lib/redis";

export type FeedLinkRow = {
  id: string;
  url: string;
  likesCount: number;
  anonymous: boolean;
  isBoosted?: boolean;
};

// Per-viewer feed page cache. The feed RPC joins the DB-side eligibility
// cache (cheap), but users poll the feed every ~60s — a 15s Redis TTL cuts
// most RPC calls. Staleness is already accepted app-wide (likes_count drifts
// until the next fetch), so no explicit invalidation.
const FEED_CACHE_TTL_SECONDS = 15;

export async function getFeed(
  viewerId: string,
  offset = 0,
  limit = 50,
): Promise<{ links: FeedLinkRow[]; nextOffset: number }> {
  const cacheKey = `feed:${viewerId}:${offset}`;
  const cached = await cacheGet<{ links: FeedLinkRow[]; nextOffset: number }>(cacheKey);
  if (cached) return cached;

  const settings = await getSettings();

  try {
    const links = await getEligibleFeedLinks({
      viewerId,
      activeLikeCount: settings.activeLikeCount,
      activeWindowHours: settings.activeWindowHours,
      cooldownHours: LINK_COOLDOWN_HOURS,
      limit,
      offset,
    });

    const formattedLinks: FeedLinkRow[] = links.map((l) => ({
      id: l.id,
      url: l.url,
      likesCount: l.likes_count,
      anonymous: l.anonymous,
      isBoosted: l.is_boosted,
    }));

    const result = { links: formattedLinks, nextOffset: offset + formattedLinks.length };
    await cacheSet(cacheKey, result, FEED_CACHE_TTL_SECONDS);
    return result;
  } catch (err) {
    console.error("[feed] get_eligible_feed_links error:", (err as Error).message);
    // Don't cache failures — a transient outage shouldn't freeze an empty
    // feed for the next 15s.
    return { links: [], nextOffset: offset };
  }
}
