"use server";

import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { issueAdViewToken, verifyAdViewToken, consumeAdViewToken } from "@/lib/ad-view-token";
import { checkRateLimit } from "@/lib/rate-limit";
import { bangladeshMidnightISO } from "@/lib/timezone";
import { TOTAL_AD_SECONDS } from "@/lib/types";

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

  // Single-use: reject a replay of this exact token immediately, before
  // spending any DB round-trips on it.
  if (!consumeAdViewToken(claims.jti)) {
    console.warn("[commitLikeAction] Ad-view token already used:", claims.jti);
    return { ok: false, error: "ad-view token already used" };
  }

  // ── Server-side elapsed-time enforcement ──────────────────────────────
  // The token carries the server timestamp from startAdView(). Verify that
  // the client actually waited the full ad-view duration before committing.
  // A 1-second grace window tolerates minor clock skew and network latency,
  // but rejects instant commits that bypass the client-side timer entirely.
  const elapsed = Date.now() - claims.startedAtMs;
  const minRequiredMs = TOTAL_AD_SECONDS * 1000 - 1000; // 8 s minimum (9 s total, 1 s grace)
  if (elapsed < minRequiredMs) {
    console.warn(
      "[commitLikeAction] Commit too early:",
      Math.round(elapsed / 1000), "s elapsed, need ≥", Math.round(minRequiredMs / 1000), "s",
    );
    return { ok: false, error: "too_early" };
  }

  // Parallel: link+owner in one join, settings via React-cached helper.
  // Exposure/deficit/cooldown are enforced inside process_like_commit — the
  // previous TS pre-checks duplicated those COUNTs over 122k+ likes (~4s).
  const [linkResult, settings] = await Promise.all([
    supabase
      .from("links")
      .select("user_id, profiles!inner(is_elite, is_boosted)")
      .eq("id", linkId)
      .single(),
    getSettings(),
  ]);

  const { data: link, error: linkError } = linkResult;
  if (linkError || !link) {
    console.warn("[commitLikeAction] Link not found:", linkId, linkError?.message);
    return { ok: false, error: "link_not_found" };
  }

  const linkData = link as any;
  const receiver_id = linkData.user_id as string;
  if (receiver_id === user.id) {
    console.warn("[commitLikeAction] Self-like attempt:", linkId);
    return { ok: false, error: "self_like" };
  }

  const owner = (Array.isArray(linkData.profiles) ? linkData.profiles[0] : linkData.profiles) as
    | { is_elite?: boolean; is_boosted?: boolean }
    | null;
  if (!owner) {
    console.warn("[commitLikeAction] Owner profile not found for receiver:", receiver_id);
    return { ok: false, error: "owner_not_found" };
  }

  const isAnon = user.isElite;
  const isActuallyBoosted = source === "boosted" && !!owner.is_boosted && !owner.is_elite;

  const { data: rpcResult, error: rpcError } = await supabase.rpc("process_like_commit", {
    p_liker_id: user.id,
    p_link_id: linkId,
    p_receiver_id: receiver_id,
    p_is_anon: isAnon,
    p_is_boosted_like: isActuallyBoosted,
    p_offer_active: settings.offerActive,
    p_offer_likes_required: settings.offerLikesRequired,
    p_offer_autolike_minutes: settings.offerAutoLikeMinutes,
    p_active_window_hours: settings.activeWindowHours,
    p_active_like_count: settings.activeLikeCount,
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
