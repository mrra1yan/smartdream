/**
 * Session JWT (HS256, jose) — replaces Supabase Auth sessions and the
 * `sb-*-auth-token` cookie pair with a single `sd_session` cookie.
 *
 * Claims: sub (user id), role, status, iat, exp, jti. The middleware reads
 * role/status straight from the JWT (zero-network route guards); the real
 * authorization boundary is `getCurrentUser()` (src/lib/auth.ts), which
 * re-reads the profile row through a 60s Redis cache — so an admin's
 * role/status change converges within a minute, same trust model as before.
 *
 * Works on both the Edge runtime (middleware — jose uses WebCrypto) and the
 * Node runtime (server actions/components).
 */

import { SignJWT, jwtVerify } from "jose";
import { getJwtSecret } from "@/lib/jwt-secret";

export type SessionClaims = {
  sub: string;
  role: "user" | "admin" | "super_admin";
  status: "pending" | "approved" | "rejected";
};

export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "sd_session";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days, sliding refresh in middleware

export function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ role: claims.role, status: claims.status } as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getJwtSecret());
}

/** Verifies a session token. Returns claims or null (expired/invalid). */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    const role = (payload.role as SessionClaims["role"]) ?? "user";
    const status = (payload.status as SessionClaims["status"]) ?? "pending";
    return { sub: payload.sub, role, status };
  } catch {
    return null;
  }
}

/**
 * Zero-network session extraction from the request cookies (fast path for
 * middleware route guards and server-side getSession()). Async now — the JWT
 * signature is actually verified (jose WebCrypto), unlike the old
 * unverified-payload decode.
 */
export async function getSessionFromCookie(
  cookies: { name: string; value: string }[],
): Promise<SessionClaims | null> {
  const authCookie = cookies.find((c) => c.name === SESSION_COOKIE_NAME);
  if (!authCookie?.value) return null;
  return verifySessionToken(authCookie.value);
}
