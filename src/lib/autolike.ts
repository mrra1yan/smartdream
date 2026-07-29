import "server-only";
import { supabase, Profile } from "@/lib/supabase";
import { getSession } from "@/lib/session";

export type AutoLikeStatus = {
  paidEnabled: boolean;
  paidModel: string;
  paidExpiry: string | null;
  paidQuota: number | null;
  paidUsed: number;
  freeUntil: string | null;
  active: boolean;
  paused: boolean;
  remainingMinutes: number | null;
  remainingLikes: number | null;
};

const INACTIVE: AutoLikeStatus = {
  paidEnabled: false,
  paidModel: "none",
  paidExpiry: null,
  paidQuota: null,
  paidUsed: 0,
  freeUntil: null,
  active: false,
  paused: false,
  remainingMinutes: null,
  remainingLikes: null,
};

export async function getAutoLikeStatus(): Promise<AutoLikeStatus> {
  const session = await getSession();
  if (!session) return INACTIVE;

  const { data, error } = await supabase
    .from("profiles")
    // Narrow column selection — getAutoLikeStatus only uses 9 of 28 columns.
    // Every ~20s during Auto-Like, a SELECT * was pulling 2 KB of unused data
    // across the wire (boost prices, level thresholds, etc.). Explicit columns
    // cut per-call egress by ~68 %.
    .select(
      "auto_like_enabled, auto_like_paused, auto_like_model, auto_like_expiry, auto_like_quota, auto_like_used, free_autolike_until, auto_like_paused_remaining_minutes, free_autolike_paused_remaining_minutes",
    )
    .eq("id", session.sub)
    .single();

  if (error || !data) return INACTIVE;

  const profile = data as Profile;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  let paidActive = false;
  if (profile.auto_like_enabled && !profile.auto_like_paused) {
    if (profile.auto_like_model === "no_expiry") {
      paidActive = true;
    } else if (profile.auto_like_model === "time" && profile.auto_like_expiry) {
      paidActive = profile.auto_like_expiry > nowIso;
    } else if (profile.auto_like_model === "usage") {
      paidActive = (profile.auto_like_quota ?? 0) > profile.auto_like_used;
    }
  }

  let freeActive = false;
  if (!profile.auto_like_paused && profile.free_autolike_until && profile.free_autolike_until > nowIso) {
    freeActive = true;
  }

  const active = paidActive || freeActive;

  let remainingMinutes: number | null = null;
  if (profile.auto_like_paused) {
    if (profile.free_autolike_paused_remaining_minutes != null && profile.free_autolike_paused_remaining_minutes > 0) {
      remainingMinutes = profile.free_autolike_paused_remaining_minutes;
    } else if (profile.auto_like_paused_remaining_minutes != null && profile.auto_like_paused_remaining_minutes > 0) {
      remainingMinutes = profile.auto_like_paused_remaining_minutes;
    }
  } else {
    if (freeActive && profile.free_autolike_until) {
      remainingMinutes = Math.max(
        0,
        Math.floor(
          (new Date(profile.free_autolike_until).getTime() - now) / 60000,
        ),
      );
    } else if (
      paidActive &&
      profile.auto_like_model === "time" &&
      profile.auto_like_expiry
    ) {
      remainingMinutes = Math.max(
        0,
        Math.floor(
          (new Date(profile.auto_like_expiry).getTime() - now) / 60000,
        ),
      );
    }
  }

  let remainingLikes: number | null = null;
  if (profile.auto_like_model === "usage") {
    remainingLikes = (profile.auto_like_quota ?? 0) - profile.auto_like_used;
  }

  return {
    paidEnabled: profile.auto_like_enabled,
    paidModel: profile.auto_like_model,
    paidExpiry: profile.auto_like_expiry,
    paidQuota: profile.auto_like_quota,
    paidUsed: profile.auto_like_used,
    freeUntil: profile.free_autolike_until,
    active,
    paused: profile.auto_like_paused,
    remainingMinutes,
    remainingLikes,
  };
}
