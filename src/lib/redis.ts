import "server-only";
import { Redis } from "ioredis";

/**
 * Redis client for object caching + pub/sub (realtime).
 *
 * Cache key map (TTLs / invalidation points are documented per repo):
 *   settings                            JSON, 60s
 *   profile:{id}                        JSON, 60s
 *   profile:email:{email}               id,    300s
 *   profile:phone:{phone}               id,    300s
 *   profile:pub:{public_id}             id,    300s
 *   feed:{viewerId}:{offset}            JSON,  15s
 *   blog:list | blog:slug:{slug}        JSON, 300s
 *   rl:{action}:{ip}:{id}               INCR+EXPIRE
 *   sess:v:{userId}                     int, 30d (session version bump)
 *   chan:stats:{userId} / chan:links:{userId}  pub/sub channels (SSE)
 *
 * Resilience rule: Redis is a cache, never a hard dependency. Every helper
 * swallows connection errors so a downed Redis degrades to cache-miss +
 * direct DB reads instead of failing requests.
 */

export const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  lazyConnect: true,
  connectTimeout: 2000,
});

/** Dedicated client for subscriptions (SSE route uses this; the main client
 *  must never be in subscribe mode). */
export const redisSub = redis.duplicate();

// ioredis clients MUST have an 'error' listener: without one, a connection
// failure (e.g. Redis down) emits an unhandled 'error' event that crashes
// the Node process. Every helper already swallows operation errors — this
// listener is what keeps the client itself from throwing.
redis.on("error", (err) =>
  console.error("[redis] client error:", (err as Error).message),
);
redisSub.on("error", (err) =>
  console.error("[redis] subscriber error:", (err as Error).message),
);

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error("[redis] cacheGet failed for", key, (err as Error).message);
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    console.error("[redis] cacheSet failed for", key, (err as Error).message);
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch (err) {
    console.error("[redis] cacheDel failed", (err as Error).message);
  }
}
