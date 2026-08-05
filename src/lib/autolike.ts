import "server-only";
import { getCurrentUser } from "@/lib/auth";

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
  // Route through getCurrentUser() rather than an uncached getProfile(): this
  // endpoint is polled by the client (every ~20 auto-like ticks, ~100s) and
  // getCurrentUser is React-cached per request AND Redis-cached across requests
  // (60s TTL). The status route handler already calls getCurrentUser() for its
  // auth check, so this also dedupes to the same read within a single request.
  const user = await getCurrentUser();
  if (!user) return INACTIVE;

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  let paidActive = false;
  if (user.autoLikeEnabled && !user.autoLikePaused) {
    if (user.autoLikeModel === "no_expiry") {
      paidActive = true;
    } else if (user.autoLikeModel === "time" && user.autoLikeExpiry) {
      paidActive = user.autoLikeExpiry > nowIso;
    } else if (user.autoLikeModel === "usage") {
      paidActive = (user.autoLikeQuota ?? 0) > user.autoLikeUsed;
    }
  }

  let freeActive = false;
  if (!user.autoLikePaused && user.freeAutoLikeUntil && user.freeAutoLikeUntil > nowIso) {
    freeActive = true;
  }

  const active = paidActive || freeActive;

  let remainingMinutes: number | null = null;
  if (user.autoLikePaused) {
    if (user.freeAutolikePausedRemainingMinutes != null && user.freeAutolikePausedRemainingMinutes > 0) {
      remainingMinutes = user.freeAutolikePausedRemainingMinutes;
    } else if (user.autoLikePausedRemainingMinutes != null && user.autoLikePausedRemainingMinutes > 0) {
      remainingMinutes = user.autoLikePausedRemainingMinutes;
    }
  } else {
    if (freeActive && user.freeAutoLikeUntil) {
      remainingMinutes = Math.max(
        0,
        Math.floor(
          (new Date(user.freeAutoLikeUntil).getTime() - now) / 60000,
        ),
      );
    } else if (
      paidActive &&
      user.autoLikeModel === "time" &&
      user.autoLikeExpiry
    ) {
      remainingMinutes = Math.max(
        0,
        Math.floor(
          (new Date(user.autoLikeExpiry).getTime() - now) / 60000,
        ),
      );
    }
  }

  let remainingLikes: number | null = null;
  if (user.autoLikeModel === "usage") {
    remainingLikes = (user.autoLikeQuota ?? 0) - user.autoLikeUsed;
  }

  return {
    paidEnabled: user.autoLikeEnabled,
    paidModel: user.autoLikeModel,
    paidExpiry: user.autoLikeExpiry,
    paidQuota: user.autoLikeQuota,
    paidUsed: user.autoLikeUsed,
    freeUntil: user.freeAutoLikeUntil,
    active,
    paused: user.autoLikePaused,
    remainingMinutes,
    remainingLikes,
  };
}
