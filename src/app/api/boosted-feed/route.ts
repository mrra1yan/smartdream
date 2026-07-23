import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getBoostedFeed } from "@/lib/feed";
import { checkRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.status !== "approved") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Same rationale as /api/feed's rate limit — see src/lib/feed.ts /
  // getBoostedFeed for the equivalent full-computation-then-slice pattern
  // this mitigates (not fixes) against tight-loop pagination spam.
  const rateLimitOk = await checkRateLimit("boosted_feed", user.id, {
    maxAttempts: 30,
    windowMs: 60_000,
    perUserOnly: true,
  });
  if (!rateLimitOk) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, Math.min(Number(searchParams.get("limit")) || 50, 100));
  const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0);

  const result = await getBoostedFeed(user.id, user.boostedOfferCount, offset, limit);
  return NextResponse.json(result);
}
