import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAutoLikeStatus } from "@/lib/autolike";
import { updateProfile } from "@/lib/repos/profiles";
import { invalidateProfileCache } from "@/lib/profile-cache";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.status !== "approved") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await getAutoLikeStatus());
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.status !== "approved") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Fail CLOSED: a same-origin browser fetch() for a state-changing POST like
  // this always sends an Origin header — a request with NEITHER present is
  // not a legitimate first-party call.
  const origin = request.headers.get("origin") || request.headers.get("referer");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!origin || !host) {
    return NextResponse.json({ error: "csrf validation failed" }, { status: 403 });
  }
  try {
    const originHost = origin.startsWith("http") ? new URL(origin).host : origin;
    const cleanOriginHost = originHost.split(":")[0];
    const cleanHost = host.split(":")[0];
    if (cleanOriginHost !== cleanHost) {
      return NextResponse.json({ error: "csrf validation failed" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "invalid origin" }, { status: 403 });
  }

  // Reuse the already-fetched profile from getCurrentUser() at the top of
  // this handler (React-cache-deduped).
  const { action } = await request.json();

  if (action === "pause") {
    if (user.autoLikePaused) {
      return NextResponse.json(await getAutoLikeStatus());
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    let paidRemainingMins = null;
    if (user.autoLikeModel === "time" && user.autoLikeExpiry) {
      paidRemainingMins = Math.max(
        0,
        Math.floor((new Date(user.autoLikeExpiry).getTime() - now) / 60000)
      );
    }

    let freeRemainingMins = null;
    if (user.freeAutoLikeUntil && user.freeAutoLikeUntil > nowIso) {
      freeRemainingMins = Math.max(
        0,
        Math.floor((new Date(user.freeAutoLikeUntil).getTime() - now) / 60000)
      );
    }

    await updateProfile(user.id, {
      auto_like_paused: true,
      auto_like_paused_remaining_minutes: paidRemainingMins,
      free_autolike_paused_remaining_minutes: freeRemainingMins,
      auto_like_expiry: null,
      free_autolike_until: null,
    });
    await invalidateProfileCache(user.id);

  } else if (action === "resume") {
    if (!user.autoLikePaused) {
      return NextResponse.json(await getAutoLikeStatus());
    }

    let newPaidExpiry = null;
    if (user.autoLikePausedRemainingMinutes != null && user.autoLikePausedRemainingMinutes > 0) {
      newPaidExpiry = new Date(Date.now() + user.autoLikePausedRemainingMinutes * 60000).toISOString();
    }

    let newFreeUntil = null;
    if (user.freeAutolikePausedRemainingMinutes != null && user.freeAutolikePausedRemainingMinutes > 0) {
      newFreeUntil = new Date(Date.now() + user.freeAutolikePausedRemainingMinutes * 60000).toISOString();
    }

    await updateProfile(user.id, {
      auto_like_paused: false,
      auto_like_paused_remaining_minutes: null,
      free_autolike_paused_remaining_minutes: null,
      auto_like_expiry: newPaidExpiry,
      free_autolike_until: newFreeUntil,
    });
    await invalidateProfileCache(user.id);
  }

  return NextResponse.json(await getAutoLikeStatus());
}
