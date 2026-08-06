"use server";

import { getCurrentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { issueAdViewToken, verifyAdViewToken, consumeAdViewToken } from "@/lib/ad-view-token";
import { checkRateLimit } from "@/lib/rate-limit";
import { cacheDelPattern } from "@/lib/redis";
import { bangladeshMidnightISO } from "@/lib/timezone";
import { TOTAL_AD_SECONDS, LINK_COOLDOWN_HOURS } from "@/lib/types";
import { getLinkOwner } from "@/lib/repos/links";
import { processLikeCommit } from "@/lib/repos/rpc";
import { publishLinksUpdate, publishStatsUpdate } from "@/lib/realtime-publish";

// Legitimate ceiling: the client runs at most MAX_CONCURRENT_ADS (3) ad slots
// at once, each cycling roughly every TOTAL_AD_SECONDS (14s) plus network/UI
// overhead.
const AD_VIEW_RATE_LIMIT = { maxAttempts: 60, windowMs: 60_000, perUserOnly: true } as const;

/**
 * Starts an ad-view session and returns a signed JWT that the client must
 * present when committing the like.
 *
 * @param clientStartedAtMs — The wall-clock time (ms since epoch) when the ad
 *   was first opened on the client.  The server uses this (instead of its own
 *   `Date.now()`) so the elapsed-time check at commit time matches what the
 *   user actually experienced, regardless of network latency.  The value is
 *   sanity-checked: must not be in the future and must not be more than 30 s
 *   in the past.  If omitted, `Date.now()` is used as a fallback.
 */
export async function startAdView(
  linkId: string,
  source?: "boosted",
  clientStartedAtMs?: number,
): Promise<{ token: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user || user.status !== "approved") return { error: "unauthorized" };
  if (!linkId) return { error: "linkId required" };

  const allowed = await checkRateLimit("ad_view_start", user.id, AD_VIEW_RATE_LIMIT);
  if (!allowed) return { error: "rate_limited" };

  const link = await getLinkOwner(linkId);
  if (!link || link.user_id === user.id) {
    return { error: "invalid link" };
  }

  // Sanity-check the client-provided timestamp: not in the future, not too stale.
  const now = Date.now();
  let effectiveStartedAtMs = now;
  if (typeof clientStartedAtMs === "number" && clientStartedAtMs > 0) {
    if (clientStartedAtMs > now + 5_000) {
      // Clock skew / tampering — clamp to now.
      effectiveStartedAtMs = now;
    } else if (now - clientStartedAtMs > 30_000) {
      // More than 30 s stale — clamp to 30 s ago to prevent abuse.
      effectiveStartedAtMs = now - 30_000;
    } else {
      effectiveStartedAtMs = clientStartedAtMs;
    }
  }

  const token = await issueAdViewToken({
    sub: user.id,
    linkId,
    source,
    startedAtMs: effectiveStartedAtMs,
  });
  return { token };
}

export async function commitLikeAction(
  linkId: string,
  source: "boosted" | undefined,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user || user.status !== "approved") {
    console.warn("[commitLikeAction] Unauthorized user or status not approved:", user?.id, user?.status);
    return { ok: false, error: "unauthorized" };
  }

  if (!linkId) return { ok: false, error: "linkId required" };
  if (!token) return { ok: false, error: "missing ad-view token" };

  const allowed = await checkRateLimit("ad_view_commit", user.id, AD_VIEW_RATE_LIMIT);
  if (!allowed) {
    console.warn("[commitLikeAction] Rate limited for user:", user.id);
    return { ok: false, error: "rate_limited" };
  }

  const claims = await verifyAdViewToken(token);
  if (
    !claims ||
    claims.sub !== user.id ||
    claims.linkId !== linkId ||
    claims.source !== source
  ) {
    console.warn("[commitLikeAction] Invalid ad-view token for link:", linkId);
    return { ok: false, error: "invalid ad-view token" };
  }

  // ── Server-side elapsed-time enforcement ──────────────────────────────
  const elapsed = Date.now() - claims.startedAtMs;
  const minRequiredMs = TOTAL_AD_SECONDS * 1000 - 1000; // 13 s minimum (14 s total, 1 s grace)
  if (elapsed < minRequiredMs) {
    console.warn(
      "[commitLikeAction] Commit too early:",
      Math.round(elapsed / 1000), "s elapsed, need ≥", Math.round(minRequiredMs / 1000), "s",
    );
    return { ok: false, error: "too_early" };
  }

  // Parallel: link+owner in one join, settings via Redis-cached helper.
  const [link, settings] = await Promise.all([getLinkOwner(linkId), getSettings()]);

  if (!link) {
    console.warn("[commitLikeAction] Link not found:", linkId);
    return { ok: false, error: "link_not_found" };
  }

  const receiver_id = link.user_id;
  if (receiver_id === user.id) {
    console.warn("[commitLikeAction] Self-like attempt:", linkId);
    return { ok: false, error: "self_like" };
  }

  const isAnon = user.isElite;
  const isActuallyBoosted = source === "boosted" && !!link.is_boosted && !link.is_elite;

  const committed = await processLikeCommit({
    likerId: user.id,
    linkId,
    receiverId: receiver_id,
    isAnon,
    isBoostedLike: isActuallyBoosted,
    offerActive: settings.offerActive,
    offerLikesRequired: settings.offerLikesRequired,
    offerAutoLikeMinutes: settings.offerAutoLikeMinutes,
    activeWindowHours: settings.activeWindowHours,
    activeLikeCount: settings.activeLikeCount,
    cooldownHours: LINK_COOLDOWN_HOURS,
    todayIso: bangladeshMidnightISO(),
  });

  if (!committed) {
    console.warn("[commitLikeAction] RPC rejected (cooldown or owner eligibility) for link:", linkId);
    return { ok: false, error: "cooldown_active" };
  }

  // The DB commit is authoritative. Consume the token only after the like
  // row and likes_count update succeeded; a transient DB failure must remain
  // retryable with the same token.
  if (!(await consumeAdViewToken(claims.jti))) {
    console.warn("[commitLikeAction] Token was already consumed after a successful DB commit:", claims.jti);
  }

  // Fire realtime notifications (best-effort): the receiver's stats channel
  // and the link owner's links channel (their likes_count just went up).
  await Promise.all([
    publishStatsUpdate(receiver_id),
    publishLinksUpdate(receiver_id),
  ]);

  // Invalidate the liker's feed cache so the just-liked link disappears
  // immediately on page refresh — the Redis feed cache (15s TTL) otherwise
  // serves stale data that still includes this link.
  await cacheDelPattern(`feed:${user.id}:*`);

  console.log("[commitLikeAction] SUCCESS for link:", linkId);
  return { ok: true };
}
