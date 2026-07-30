import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getSessionFromCookie } from "@/lib/session-cookie";

/**
 * Thin session shim over Supabase Auth.
 *
 * The previous hand-rolled auth kept a jose-signed JWT in the `session`
 * cookie and exposed `{ sub, role, status }` from it. Auth now lives in
 * Supabase (`@supabase/ssr`), but several server modules (`autolike.ts`,
 * `stats.ts`) still call `getSession()` to resolve the current user id.
 *
 * This shim preserves that API by decoding the JWT directly from the
 * Supabase auth cookie — zero network calls, sub-millisecond resolution.
 * Token revocation / freshness is enforced by Supabase RLS on the
 * downstream DB queries, not by this function.
 *
 * Wrapped in React's `cache()` so multiple calls within the same request
 * (e.g. from `getCurrentUser()` + `getMyStats()`) share the same result.
 */

export type SessionPayload = {
  sub: string; // userId (== auth.users.id)
  role: "user" | "admin" | "super_admin";
  status: "pending" | "approved" | "rejected";
};

/** Returns the active session payload, or null when there is no signed-in user. */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const store = await cookies();
  const claims = getSessionFromCookie(store.getAll());
  if (!claims) return null;

  return {
    sub: claims.sub,
    role: claims.role as SessionPayload["role"],
    status: claims.status as SessionPayload["status"],
  };
});
