/**
 * Single source of truth for the HS256 JWT secret used to sign/verify session
 * tokens (src/lib/session-cookie.ts), ad-view tokens (src/lib/ad-view-token.ts),
 * and the edge middleware's sliding-refresh re-sign (src/middleware.ts).
 *
 * SECURITY: in production, a missing JWT_SECRET is a hard failure — without this
 * guard the three call sites would silently fall back to the committed
 * `dev-secret-change-me` constant, which would let anyone forge a valid session
 * cookie (incl. a super_admin/approved one). Failing fast on boot / first use is
 * far better than running an exploitable server.
 *
 * Edge-safe: depends only on `process.env` and `TextEncoder`, both available in
 * the Edge runtime (the middleware runs there and has no Node APIs).
 */

const FALLBACK_DEV_SECRET = "dev-secret-change-me";

/**
 * Returns the JWT secret as a UTF-8 byte array for jose. Throws in production
 * if JWT_SECRET is unset/empty. In non-production it returns the well-known
 * dev fallback so local `next dev` keeps working without a .env entry.
 */
export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Missing JWT_SECRET environment variable in production — refusing to start.",
      );
    }
    return new TextEncoder().encode(FALLBACK_DEV_SECRET);
  }
  return new TextEncoder().encode(secret);
}
