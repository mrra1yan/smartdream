import "server-only";
import { randomUUID } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { getJwtSecret } from "@/lib/jwt-secret";
import { redis } from "@/lib/redis";

const SECRET = getJwtSecret();
const TOKEN_TTL = "10m";
const TOKEN_TTL_MS = 10 * 60 * 1000;

export type AdViewTokenPayload = {
  sub: string; // userId
  linkId: string;
  source?: "boosted";
  startedAtMs: number;
  jti: string;
};

/** Server-signed proof that a specific user started viewing a specific
 *  link's ad at a specific client-observed time. Used to verify — at
 *  like-commit time — that the required view duration actually elapsed,
 *  instead of trusting the client's own timer.
 *
 *  `startedAtMs` is provided by the client (the wall-clock time when the ad
 *  was first opened, measured via `Date.now()` on the user's device).  The
 *  server sanity-checks the value (not in the future, not > 30 s stale)
 *  before issuing the token.
 *
 *  Carries a random `jti` so a captured token can be marked single-use at
 *  commit time (see `consumeAdViewToken`). */
export async function issueAdViewToken(
  payload: Omit<AdViewTokenPayload, "jti">,
): Promise<string> {
  const jti = randomUUID();
  return new SignJWT({ ...payload, typ: "adview" } as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .setJti(jti)
    .sign(SECRET);
}

export async function verifyAdViewToken(token: string): Promise<AdViewTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, { algorithms: ["HS256"] });
    if (payload.typ !== "adview") return null;
    if (
      typeof payload.sub !== "string" ||
      typeof payload.linkId !== "string" ||
      typeof payload.startedAtMs !== "number" ||
      typeof payload.jti !== "string"
    ) {
      return null;
    }
    return {
      sub: payload.sub,
      linkId: payload.linkId,
      source: payload.source === "boosted" ? "boosted" : undefined,
      startedAtMs: payload.startedAtMs,
      jti: payload.jti,
    };
  } catch {
    return null;
  }
}

// --- Single-use enforcement -------------------------------------------------
//
// Two-layer defence against token replay:
// 1. In-memory Map (fast path, per-instance)
// 2. Redis SET NX (cross-instance, for multi-instance deployments)
//
// The 12h cooldown enforced by process_like_commit (under a per-(liker,link)
// advisory lock) is the authoritative backstop — a second commit attempt for
// the same pair inside the cooldown window is rejected by the DB regardless.
// What the DB-level guard does NOT stop is concurrent commitLikeAction calls
// with the identical token across different server instances, each paying the
// full cost of the link/settings/owner lookups before colliding on the DB lock.
// Redis tracks the JTI globally so we can reject obvious replays immediately.
//
// Redis is a soft dependency: if it's down, we fall back to in-memory only
// (the DB cooldown remains the ultimate gate).
const CONSUMED_JTI_TTL_SECONDS = Math.ceil((TOKEN_TTL_MS + 60_000) / 1000); // slightly longer than token expiry
const CONSUMED_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const JTI_REDIS_PREFIX = "jti:";

const consumedJtis = new Map<string, number>(); // jti -> expiresAt (ms)
let lastConsumedSweep = Date.now();

function sweepConsumedJtis(now: number) {
  if (now - lastConsumedSweep < CONSUMED_SWEEP_INTERVAL_MS) return;
  lastConsumedSweep = now;
  for (const [jti, expiresAt] of consumedJtis) {
    if (now > expiresAt) consumedJtis.delete(jti);
  }
}

/** Marks a verified token's `jti` as spent. Returns `true` the first time
 *  it's called for a given `jti` (the caller may proceed), `false` on any
 *  subsequent call for the same `jti` (a replay — the caller must reject).
 *
 *  Checks an in-memory Map first (fast, per-instance), then falls back to
 *  Redis SET NX for cross-instance tracking.  If Redis is unavailable the
 *  function returns `true` (degraded mode — the DB cooldown is the backstop).
 *
 *  Call this once after a token has passed verification and the
 *  elapsed-view-time check, before doing any further work on its behalf. */
export async function consumeAdViewToken(jti: string): Promise<boolean> {
  const now = Date.now();
  sweepConsumedJtis(now);

  // Fast path: in-memory (already seen on this instance)
  if (consumedJtis.has(jti)) return false;

  // Cross-instance check via Redis SET NX (atomic "set if not exists")
  try {
    const redisKey = `${JTI_REDIS_PREFIX}${jti}`;
    // SET key value NX EX ttl → returns "OK" if key was set (first use),
    // null if key already existed (replay).
    const result = await redis.set(redisKey, "1", "EX", CONSUMED_JTI_TTL_SECONDS, "NX");
    if (result !== "OK") {
      // Key already existed in Redis — replay detected
      return false;
    }
  } catch (err) {
    // Redis unavailable — degrade gracefully.  The DB cooldown is the
    // backstop; a replay would still be rejected by process_like_commit.
    console.warn("[consumeAdViewToken] Redis unavailable, falling back to in-memory only:", (err as Error).message);
  }

  // First use confirmed — cache in-memory so future checks on this instance
  // skip the Redis round-trip.
  consumedJtis.set(jti, now + CONSUMED_JTI_TTL_SECONDS * 1000);
  return true;
}
