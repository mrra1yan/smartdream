import "server-only";
import { redis } from "@/lib/redis";

/**
 * Realtime publish helpers. Server actions PUBLISH to per-user channels;
 * the SSE route (src/app/api/realtime/route.ts) subscribes and forwards to
 * the browser. All best-effort: a Redis failure must never break the action.
 */

export async function publishStatsUpdate(userId: string): Promise<void> {
  try {
    await redis.publish(`chan:stats:${userId}`, JSON.stringify({ t: "like" }));
  } catch (err) {
    console.error("[realtime] publishStatsUpdate failed:", (err as Error).message);
  }
}

export async function publishLinksUpdate(userId: string): Promise<void> {
  try {
    await redis.publish(`chan:links:${userId}`, JSON.stringify({ t: "links" }));
  } catch (err) {
    console.error("[realtime] publishLinksUpdate failed:", (err as Error).message);
  }
}
