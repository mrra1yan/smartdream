import "server-only";
import { LINK_COOLDOWN_HOURS } from "@/lib/types";
import { bangladeshMidnightISO } from "@/lib/timezone";
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

  const cooldownIso = hoursAgoISO(LINK_COOLDOWN_HOURS);
  const windowIso = bangladeshMidnightISO();

  const cooldownLinks = await fetchAll(async (from, to) =>
    await supabase
      .from("likes")
      .select("link_id")
      .eq("liker_id", viewerId)
      .gte("created_at", cooldownIso)
      .range(from, to)
  );

  const cooldownSet = new Set(cooldownLinks.map((l: any) => l.link_id));

  // Both params intentionally get the same activeWindowHours-based
  // timestamp. get_feed_user_stats (supabase_rpc.sql) names its second
  // param/columns "minus24h"/"*_24h" because the deficit window used to be
  // hardcoded to literally 24 hours everywhere; when that got promoted to
  // the configurable settings.activeWindowHours, this call site kept
  // passing a genuinely hardcoded hoursAgoISO(24) for it while
  // process_like_commit (supabase/migrations/0005_phase3_hardening.sql) and
  // commitLikeAction's early-exit (src/app/actions/like.ts) both moved to
  // the configurable value. Whenever an admin sets activeWindowHours to
  // the configurable value. Whenever an admin sets activeWindowHours to
  // anything other than 24, that mismatch made the feed's given/received
  // ratio (the slowdown probability and the hard r24>g24 cutoff below) use a
  // different window than the commit-time check that actually decides
  // whether a like is accepted -- showing owners the commit would reject
  // (wasted ad-view cycles) or hiding owners the commit would have allowed
  // (needlessly shrinking the feed). 
  // We pass hoursAgoISO for window_iso to prevent the entire feed from
  // disappearing at exactly midnight when active_likes resets to 0.
  // minus24h_iso uses windowIso (Midnight) to align with commit rules.
  const { data: userStats, error } = await supabase.rpc("get_feed_user_stats", {
    window_iso: hoursAgoISO(settings.activeWindowHours),
    minus24h_iso: windowIso,
  });

  if (error || !userStats || userStats.length === 0) {
    console.log("[feed] get_feed_user_stats empty/error:", { err: error?.message, count: userStats?.length ?? 0 });
    return { links: [], nextOffset: offset };
  }

  const eliteIds = new Set<string>();
  const slowdownIds = new Set<string>();
  const eligibleOwnerIds: string[] = [];
  const nowMs = Date.now();

  let _dbg_total = 0, _dbg_self = 0, _dbg_elite = 0, _dbg_new = 0, _dbg_lowActive = 0, _dbg_deficit = 0, _dbg_eligible = 0;

  for (const p of userStats as any[]) {
    _dbg_total++;
    // Never surface the viewer's own links in their feed
    if (p.profile_id === viewerId) { _dbg_self++; continue; }

    if (p.is_elite) {
      _dbg_elite++;
      eliteIds.add(p.profile_id);
      eligibleOwnerIds.push(p.profile_id);
      continue;
    }

    // New user check
    const profileCreatedAtMs = new Date(p.created_at).getTime();
    const recvTotal = Number(p.recv_total) || 0;
    const isNewUser = (nowMs - profileCreatedAtMs < 24 * 3600000) && (recvTotal < settings.activeLikeCount);

    if (isNewUser) {
      _dbg_new++;
      eligibleOwnerIds.push(p.profile_id);
      continue;
    }

    const active = Number(p.active_likes) || 0;
    if (active < settings.activeLikeCount) { _dbg_lowActive++; continue; }
    
    const g24 = Number(p.given_24h) || 0;
    const r24 = Number(p.recv_24h) || 0;

    // 100% shutoff: if they have received as many or more likes than they gave (r24 >= g24 when g24 > 0)
    // Note: At exactly midnight, g24 and r24 reset to 0. With g24=0 and r24=0,
    // they are allowed to appear in the feed to receive 1 "free" like before being shut off.
    if (g24 > 0 && r24 >= g24) { _dbg_deficit++; continue; }

    _dbg_eligible++;

    // Owners nearing/at the received>=given ratio get deprioritized (pushed
    // to the back by the slowdownIds-based sort below), never hard-excluded
    // -- they must still show up, just last, if nothing else is available.
    const ratio = r24 / g24;
    const SLOWDOWN_THRESHOLD = 0.9;
    if (ratio >= SLOWDOWN_THRESHOLD) {
      slowdownIds.add(p.profile_id);
    }

    eligibleOwnerIds.push(p.profile_id);
  }

  console.log("[feed] eligibility breakdown:", {
    total: _dbg_total,
    self: _dbg_self,
    elite: _dbg_elite,
    newUser: _dbg_new,
    lowActive: _dbg_lowActive,
    deficit: _dbg_deficit,
    eligibleNonElite: _dbg_eligible,
    activeLikeCount: settings.activeLikeCount,
    activeWindowHours: settings.activeWindowHours,
    eligibleOwners: eligibleOwnerIds.length,
    cooldownSize: cooldownSet.size,
  });

  if (eligibleOwnerIds.length === 0) {
    return { links: [], nextOffset: offset };
  }

  const chunkedLinks: {
    id: string;
    url: string;
    likes_count: number;
    user_id: string;
    created_at: string;
  }[] = [];
  const chunkSize = 90;
  for (let i = 0; i < eligibleOwnerIds.length; i += chunkSize) {
    const chunk = eligibleOwnerIds.slice(i, i + chunkSize);
    const { data: links } = await supabase
      .from("links")
      .select("id, url, likes_count, user_id, created_at")
      .in("user_id", chunk)
      .gte("sort_order", 0);

    if (links) {
      chunkedLinks.push(...links);
    }
  }
  const allLinks = chunkedLinks;

  const filtered = allLinks.filter(
    (l) => l.user_id !== viewerId && !cooldownSet.has(l.id),
  );

  // Separate elite and non-elite links
  const eliteLinks = filtered.filter((l) => eliteIds.has(l.user_id));
  const nonEliteLinks = filtered.filter(
    (l) => !eliteIds.has(l.user_id)
  );

  // Sort eliteLinks by createdAt desc
  eliteLinks.sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Group nonEliteLinks by userId
  const linksByUser = new Map<string, typeof nonEliteLinks>();
  for (const l of nonEliteLinks) {
    if (!linksByUser.has(l.user_id)) {
      linksByUser.set(l.user_id, []);
    }
    linksByUser.get(l.user_id)!.push(l);
  }

  // Sort each user's links by createdAt desc
  for (const userLinks of linksByUser.values()) {
    userLinks.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  // Order users for round-robin interleaving. Elite users never reach this
  // comparator at all (they were already split into `eliteLinks` above and
  // unconditionally placed first in `combined` below) -- elite priority is a
  // hard, all-or-nothing tier, not a weighted one. `settings.eliteWeight` is
  // intentionally not read here; see the note on `combined` below.
  const sortedNonBoostedUsers = Array.from(linksByUser.keys()).sort((a, b) => {
    const aSlow = slowdownIds.has(a) ? 1 : 0;
    const bSlow = slowdownIds.has(b) ? 1 : 0;
    if (aSlow !== bSlow) {
      return aSlow - bSlow;
    }

    const aTime = new Date(linksByUser.get(a)![0]?.created_at ?? 0).getTime();
    const bTime = new Date(linksByUser.get(b)![0]?.created_at ?? 0).getTime();

    if (aTime !== bTime) {
      return bTime - aTime;
    }

    return b.localeCompare(a);
  });

  // Interleave (round-robin mixing)
  const interleavedNonBoosted: typeof nonEliteLinks = [];
  let hasMore = true;
  let depth = 0;
  while (hasMore) {
    hasMore = false;
    for (const userId of sortedNonBoostedUsers) {
      const userLinks = linksByUser.get(userId)!;
      if (depth < userLinks.length) {
        interleavedNonBoosted.push(userLinks[depth]);
        hasMore = true;
      }
    }
    depth++;
  }

  // Elite links unconditionally stay at the top of the normal feed,
  // regardless of settings.eliteWeight -- this is a hard priority tier (see
  // also like.ts's `isBypass`, which exempts elite owners from the
  // exposure/deficit check the same unconditional way), not a probabilistic
  // one. The super-admin "Elite Weight" settings control reflects this now
  // (src/components/super-admin/elite-weight-form.tsx) -- it used to promise
  // a 0-100x scale of prioritization that never actually took effect here.
  const combined = [...eliteLinks, ...interleavedNonBoosted];

  const page = combined.slice(offset, offset + limit);
  const links: FeedLinkRow[] = page.map((l) => ({
    id: l.id,
    url: l.url,
    likesCount: l.likes_count,
    anonymous: eliteIds.has(l.user_id),
    isBoosted: false,
  }));

  console.log("[feed] result:", {
    allLinksCount: allLinks.length,
    filteredCount: filtered.length,
    returnedCount: links.length,
  });

  return { links, nextOffset: offset + links.length };
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
