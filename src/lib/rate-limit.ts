import { headers } from "next/headers";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

// In-memory store (Note: Resets on server restart, not shared across distributed edge nodes)
// TODO(rate-limit infra): this Map is per-isolate. On Cloudflare Workers,
// concurrent requests can land on different isolates/edge nodes, each with
// its own independent Map, so the real effective limit is
// MAX_ATTEMPTS * (number of isolates handling this key), not MAX_ATTEMPTS.
// Fixing the IP-spoofing hole above closes the "attacker picks their own
// key" bypass, but a fully robust distributed limiter still needs a shared
// backing store (e.g. a KV namespace or Durable Object) so all isolates see
// the same counter. That's a larger infra change and out of scope here.
const store = new Map<string, RateLimitEntry>();

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// Expired entries are only ever overwritten when the same key is checked
// again, so keys that are hit once and never again would otherwise sit in
// the Map forever. Sweep them out periodically to bound memory growth.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
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
   * dodge the limit simply by switching networks, and would also let two
   * different authenticated users behind the same NAT/CGNAT/shared
   * mobile-carrier IP throttle each other.
   */
  perUserOnly?: boolean;
};

/**
 * Checks if the current request/action is rate-limited.
 * Returns true if allowed, false if rate-limited.
 *
 * Default behavior (no `options`) is unchanged from the original IP+identifier
 * keyed, 5-attempts-per-5-minutes guard used by login/signup.
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
    key = `${action}:user:${identifier ?? "no-id"}`;
  } else {
    const headersList = await headers();
    // `x-forwarded-for` is client-spoofable (any caller can set an arbitrary
    // value), which makes an IP-keyed rate limit trivially bypassable — send a
    // different bogus `x-forwarded-for` value on every request and each one
    // gets its own bucket. `cf-connecting-ip` is set by Cloudflare itself at
    // the edge (see src/app/api/embed-frame/route.ts, which already trusts it
    // for the same reason) and can't be overridden by the client, so prefer it
    // and only fall back to `x-forwarded-for`'s first entry when Cloudflare's
    // header is absent (e.g. local dev without the CF proxy in front).
    const cfConnectingIp = headersList.get("cf-connecting-ip");
    const forwardedFor = headersList.get("x-forwarded-for");
    const ip = cfConnectingIp?.trim() || (forwardedFor ? forwardedFor.split(",")[0].trim() : "unknown-ip");
    key = `${action}:${ip}:${identifier ?? "no-id"}`;
  }

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
  store.set(key, entry);
  return true;
}
