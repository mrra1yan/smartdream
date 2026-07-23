import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getFeed } from "@/lib/feed";
import { checkRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.status !== "approved") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Mitigation for the fact that getFeed() does a full unbounded computation
  // (fetches all cooldown-likes + all links for every eligible owner) before
  // slicing by offset/limit — see src/lib/feed.ts. A full pagination-at-the-
  // query-level rewrite of the feed algorithm is out of scope for this pass
  // (too risky to the round-robin/elite-weighting/slowdown ranking logic);
  // this only bounds how often a client can force that recomputation by
  // spamming e.g. ?limit=1&offset=0 in a tight loop. The underlying
  // per-call cost is NOT fixed by this — see fixer report.
  const rateLimitOk = await checkRateLimit("feed", user.id, {
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

  const { links, nextOffset } = await getFeed(user.id, offset, limit);
  return NextResponse.json({ links, nextOffset });
}
