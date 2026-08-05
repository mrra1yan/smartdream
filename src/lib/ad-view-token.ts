import "server-only";
import { randomUUID } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { getJwtSecret } from "@/lib/jwt-secret";

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
 *  link's ad at a specific server-observed time. Used to verify — at
 *  like-commit time — that the required view duration actually elapsed,
 *  instead of trusting the client's own timer. Carries a random `jti` so a
 *  captured token can be marked single-use at commit time (see
 *  `consumeAdViewToken`). */
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
// The 12h cooldown enforced by process_like_commit (supabase/migrations/
// 0003_security_hardening.sql, under a per-(liker,link) advisory lock) is the
// authoritative defense against a token being replayed to double-insert a
// like for the same link — a second commit attempt for the same pair inside
// the cooldown window is rejected by the DB regardless of how many times the
// token is replayed. What that DB-level guard does NOT do is stop a captured
// token from being replayed *before* the RPC is ever reached — e.g. several
// concurrent commitLikeAction calls with the identical token, each paying the
// full cost of the link/settings/owner/burst/exposure lookups before finally
// colliding on the DB lock. Tracking `jti` lets us reject an obvious replay
// immediately and cheaply, without waiting on the DB to be the backstop.
//
// In-memory (per server instance) is an intentional, acceptable simplification
// here: tokens are short-lived (2 minutes), so the exposure window for this
// specific gap resetting on a redeploy/cold-start is tiny, and it avoids
// standing up a DB table purely to track a 2-minute-lived nonce.
const CONSUMED_JTI_TTL_MS = TOKEN_TTL_MS + 60_000; // slightly longer than token expiry
const CONSUMED_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

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
 *  Call this once, right after a token has passed verification + the
 *  elapsed-view-time check, and before doing any further work on its
 *  behalf. */
export function consumeAdViewToken(jti: string): boolean {
  const now = Date.now();
  sweepConsumedJtis(now);
  if (consumedJtis.has(jti)) return false;
  consumedJtis.set(jti, now + CONSUMED_JTI_TTL_MS);
  return true;
}
