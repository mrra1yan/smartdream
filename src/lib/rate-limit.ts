import { headers } from "next/headers";
import { redis } from "@/lib/redis";

/**
 * Distributed rate limiter backed by Redis (INCR + EXPIRE) — fixes the old
 * per-isolate in-memory Map, which let concurrent requests on different
 * server instances/isolates each get their own bucket (the effective limit
 * was MAX_ATTEMPTS × instance count).
 *
 * If Redis is unreachable we degrade to the previous in-memory Map behavior
 * (still correct per instance, just not shared) rather than failing the
 * request.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// --- In-memory fallback (Redis down) ----------------------------------------
type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateLimitEntry>();
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
let lastSweep = Date.now();

function sweepExpired(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}

export type RateLimitOptions = {
  /** Overrides the default 5-attempt cap (login/signup abuse-guard default). */
  maxAttempts?: number;
  /** Overrides the default 5-minute window. */
  windowMs?: number;
  /**
   * When true, key on `identifier` alone (no IP component). Use this for
   * authenticated, per-user throttles (e.g. like/ad-view/feed actions) where
   * the caller is always a known `user.id` — mixing in IP would let a user
   * dodge the limit simply by switching networks.
   */
  perUserOnly?: boolean;
};

function buildKey(action: string, identifier: string | undefined, perUserOnly: boolean | undefined): string {
  if (perUserOnly) {
    return `${action}:user:${identifier ?? "no-id"}`;
  }
  return `${action}:${identifier ?? "no-id"}`;
}

/**
 * Checks if the current request/action is rate-limited.
 * Returns true if allowed, false if rate-limited.
 */
export async function checkRateLimit(
  action: string,
  identifier?: string,
  options?: RateLimitOptions,
): Promise<boolean> {
  const maxAttempts = options?.maxAttempts ?? MAX_ATTEMPTS;
  const windowMs = options?.windowMs ?? WINDOW_MS;

  let key: string;
  if (options?.perUserOnly) {
    key = buildKey(action, identifier, true);
  } else {
    const headersList = await headers();
    // `x-forwarded-for` is client-spoofable; `cf-connecting-ip` is set by
    // Cloudflare itself and can't be overridden by the client — prefer it,
    // fall back to x-forwarded-for's first entry only when absent (local dev).
    const cfConnectingIp = headersList.get("cf-connecting-ip");
    const forwardedFor = headersList.get("x-forwarded-for");
    const ip = cfConnectingIp?.trim() || (forwardedFor ? forwardedFor.split(",")[0].trim() : "unknown-ip");
    key = buildKey(action, `${ip}:${identifier ?? "no-id"}`, false);
  }

  const redisKey = `rl:${key}`;
  try {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, Math.ceil(windowMs / 1000));
    }
    return count <= maxAttempts;
  } catch (err) {
    console.error("[rate-limit] Redis unavailable, falling back to in-memory:", (err as Error).message);
    return memoryCheck(key, maxAttempts, windowMs);
  }
}

function memoryCheck(key: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();
  sweepExpired(now);

  const entry = store.get(key);
  if (!entry) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxAttempts) {
    return false;
  }
  entry.count += 1;
  return true;
}
