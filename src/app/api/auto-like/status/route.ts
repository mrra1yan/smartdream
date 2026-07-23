import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAutoLikeStatus } from "@/lib/autolike";
import { supabase } from "@/lib/supabase";

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
  // this always sends an Origin header (and virtually always a Referer too),
  // so a request with NEITHER present is not a legitimate first-party call —
  // it's most likely a cross-origin request from a context that omits both
  // (e.g. a bare HTTP client, or a request crafted to dodge this check).
  // Previously this block was skipped entirely when both were absent, which
  // let such a request through unchecked.
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

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    return NextResponse.json({ error: "profile not found" }, { status: 404 });
  }

  const { action } = await request.json();

  if (action === "pause") {
    if ((profile as any).auto_like_paused) {
      return NextResponse.json(await getAutoLikeStatus());
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    let paidRemainingMins = null;
    if ((profile as any).auto_like_model === "time" && (profile as any).auto_like_expiry) {
      paidRemainingMins = Math.max(
        0,
        Math.floor((new Date((profile as any).auto_like_expiry).getTime() - now) / 60000)
      );
    }

    let freeRemainingMins = null;
    if ((profile as any).free_autolike_until && (profile as any).free_autolike_until > nowIso) {
      freeRemainingMins = Math.max(
        0,
        Math.floor((new Date((profile as any).free_autolike_until).getTime() - now) / 60000)
      );
    }

    await supabase
      .from("profiles")
      .update({
        auto_like_paused: true,
        auto_like_paused_remaining_minutes: paidRemainingMins,
        free_autolike_paused_remaining_minutes: freeRemainingMins,
        auto_like_expiry: null,
        free_autolike_until: null,
      })
      .eq("id", user.id);

  } else if (action === "resume") {
    if (!(profile as any).auto_like_paused) {
      return NextResponse.json(await getAutoLikeStatus());
    }

    let newPaidExpiry = null;
    if ((profile as any).auto_like_paused_remaining_minutes != null && (profile as any).auto_like_paused_remaining_minutes > 0) {
      newPaidExpiry = new Date(Date.now() + (profile as any).auto_like_paused_remaining_minutes * 60000).toISOString();
    }

    let newFreeUntil = null;
    if ((profile as any).free_autolike_paused_remaining_minutes != null && (profile as any).free_autolike_paused_remaining_minutes > 0) {
      newFreeUntil = new Date(Date.now() + (profile as any).free_autolike_paused_remaining_minutes * 60000).toISOString();
    }

    await supabase
      .from("profiles")
      .update({
        auto_like_paused: false,
        auto_like_paused_remaining_minutes: null,
        free_autolike_paused_remaining_minutes: null,
        auto_like_expiry: newPaidExpiry,
        free_autolike_until: newFreeUntil,
      })
      .eq("id", user.id);
  }

  return NextResponse.json(await getAutoLikeStatus());
}
