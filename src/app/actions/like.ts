"use server";

import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { TOTAL_AD_SECONDS } from "@/lib/types";
import { issueAdViewToken, verifyAdViewToken, consumeAdViewToken } from "@/lib/ad-view-token";
import { checkRateLimit } from "@/lib/rate-limit";
import { bangladeshMidnightISO } from "@/lib/timezone";

// Legitimate ceiling: the client runs at most MAX_CONCURRENT_ADS (3) ad slots
// at once, each cycling roughly every TOTAL_AD_SECONDS (9s) plus network/UI
// overhead — around 18-20 completed ad-view cycles/minute at full throttle.
const AD_VIEW_RATE_LIMIT = { maxAttempts: 60, windowMs: 60_000, perUserOnly: true } as const;

export async function startAdView(
  linkId: string,
  source?: "boosted",
): Promise<{ token: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user || user.status !== "approved") return { error: "unauthorized" };
  if (!linkId) return { error: "linkId required" };

  const allowed = await checkRateLimit("ad_view_start", user.id, AD_VIEW_RATE_LIMIT);
  if (!allowed) return { error: "rate_limited" };

  const { data, error } = await supabase
    .from("links")
    .select("user_id")
    .eq("id", linkId)
    .single();

  if (error || !data || (data as any).user_id === user.id) {
    return { error: "invalid link" };
  }

  const token = await issueAdViewToken({
    sub: user.id,
    linkId,
    source,
    startedAtMs: Date.now(),
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

  const elapsedMs = Date.now() - claims.startedAtMs;
  const MIN_ELAPSED_MS = 7000; // 7 seconds min required to prevent false rejections from timer drift
  if (elapsedMs < MIN_ELAPSED_MS) {
    console.warn(`[commitLikeAction] Ad view duration too short: ${elapsedMs}ms (min required: ${MIN_ELAPSED_MS}ms)`);
    return { ok: false, error: "ad not fully viewed" };
  }

  // Single-use: reject a replay of this exact token immediately, before
  // spending any DB round-trips on it.
  if (!consumeAdViewToken(claims.jti)) {
    console.warn("[commitLikeAction] Ad-view token already used:", claims.jti);
    return { ok: false, error: "ad-view token already used" };
  }

  const { data: link, error: linkError } = await supabase
    .from("links")
    .select("user_id")
    .eq("id", linkId)
    .single();

  if (linkError || !link) {
    console.warn("[commitLikeAction] Link not found:", linkId, linkError?.message);
    return { ok: false, error: "link_not_found" };
  }

  const linkData = link as any;
  const receiver_id = linkData.user_id;
  if (receiver_id === user.id) {
    console.warn("[commitLikeAction] Self-like attempt:", linkId);
    return { ok: false, error: "self_like" };
  }

  const { data: settingsData } = await supabase.from("settings").select("*").eq("id", "1").single();

  const settings = (settingsData ?? {
    active_like_count: 20,
    active_window_hours: 24,
    offer_active: true,
    offer_likes_required: 10,
    offer_autolike_minutes: 30,
  }) as any;

  const { data: ownerData } = await supabase.from("profiles").select("id, created_at, is_elite, is_boosted").eq("id", receiver_id).single();
  const owner = ownerData as any;
  if (!owner) {
    console.warn("[commitLikeAction] Owner profile not found for receiver:", receiver_id);
    return { ok: false, error: "owner_not_found" };
  }

  // 3. Burst cap: at most 10 likes in last 12 seconds
  // With TOTAL_AD_SECONDS=9 and MAX_CONCURRENT_ADS=3, up to 3 ads can
  // complete within a tight window — 10 in 12s accommodates 3 concurrent slots safely.
  const burstWindow = new Date(Date.now() - 12000).toISOString();
  const { count: burstCount } = await supabase
    .from("likes")
    .select("*", { count: "exact", head: true })
    .eq("liker_id", user.id)
    .gte("created_at", burstWindow);

  if ((burstCount ?? 0) >= 10) {
    console.warn("[commitLikeAction] Burst cap hit:", burstCount, "likes in last 12s for user:", user.id);
    return { ok: false, error: "burst_cap" };
  }

  // 4. Deficit and Cold Start validation for owner.
  // NOTE: this check races against concurrent commits for the SAME owner
  // from DIFFERENT likers (the advisory lock in process_like_commit is keyed
  // per liker+link pair, not per receiver, so it doesn't serialize this).
  // It's kept here as an early-exit for the common case only — the
  // authoritative, race-free version of this same check now also runs inside
  // process_like_commit itself, under a receiver-scoped advisory lock (see
  // supabase/migrations/0005_phase3_hardening.sql).
  const isBypass = owner.is_elite || owner.is_boosted;
  if (!isBypass) {
    const { count: ownerRecvTotal } = await supabase
      .from("likes")
      .select("*", { count: "exact", head: true })
      .eq("receiver_id", owner.id)
      .eq("is_boosted_like", false);

    const ownerCreatedAtMs = new Date(owner.created_at).getTime();
    const isOwnerNewUser = (Date.now() - ownerCreatedAtMs < 24 * 3600000) &&
      ((ownerRecvTotal ?? 0) < settings.active_like_count);

    if (!isOwnerNewUser) {
      // Use rolling window to match the RPC process_like_commit instead of midnight
      const activeWindowHours = settings.active_window_hours ?? 24;
      const windowIso = new Date(Date.now() - activeWindowHours * 3600000).toISOString();

      const [{ count: given24 }, { count: recv24 }] = await Promise.all([
        // Count ALL likes given by the owner, including to boosted profiles
        supabase.from("likes").select("*", { count: "exact", head: true })
          .eq("liker_id", owner.id)
          .gte("created_at", windowIso),
        // Only count organic likes received, boosted likes are "free"
        supabase.from("likes").select("*", { count: "exact", head: true })
          .eq("receiver_id", owner.id)
          .eq("is_boosted_like", false)
          .gte("created_at", windowIso),
      ]);

      const ownerG24 = given24 ?? 0;
      const ownerR24 = recv24 ?? 0;

      if (ownerR24 > ownerG24) {
        console.warn("[commitLikeAction] Exposure limit reached for owner:", owner.id, `(given=${ownerG24}, received=${ownerR24})`);
        return { ok: false, error: "exposure_limit_reached" };
      }
    }
  }

  // 5. Commit the like atomically via RPC
  const isAnon = user.isElite;
  const isActuallyBoosted = source === "boosted" && owner.is_boosted && !owner.is_elite;

  const { data: rpcResult, error: rpcError } = await supabase.rpc("process_like_commit", {
    p_liker_id: user.id,
    p_link_id: linkId,
    p_receiver_id: receiver_id,
    p_is_anon: isAnon,
    p_is_boosted_like: isActuallyBoosted,
    p_offer_active: settings.offer_active ?? true,
    p_offer_likes_required: settings.offer_likes_required ?? 10,
    p_offer_autolike_minutes: settings.offer_autolike_minutes ?? 30,
    p_active_window_hours: settings.active_window_hours ?? 24,
    p_active_like_count: settings.active_like_count ?? 20,
    p_today_iso: bangladeshMidnightISO(),
  });

  if (rpcError) {
    console.error("[commitLikeAction] RPC error:", rpcError.message, rpcError.code);
    return { ok: false, error: "rpc_error" };
  }

  if (!rpcResult) {
    console.warn("[commitLikeAction] RPC returned false (cooldown or deficit) for link:", linkId);
    return { ok: false, error: "cooldown_active" };
  }

  console.log("[commitLikeAction] SUCCESS for link:", linkId);
  return { ok: true };
}
