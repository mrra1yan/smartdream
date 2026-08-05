import "server-only";
import { cookies } from "next/headers";
import {
  getSessionFromCookie,
  type SessionClaims,
} from "@/lib/session-cookie";

/**
 * Resolves the current session from the `sd_session` cookie.
 * Pure JWT decode/verify — no DB round-trip (the old Supabase shim made a
 * `getUser()` network call per call-site; several modules call getSession()
 * on every page load).
 */

export type SessionPayload = SessionClaims;

/** Returns the active session payload, or null when there is no signed-in
 *  user. Role/status claims may be up to ~60s stale after an admin changes
 *  them — getCurrentUser() (src/lib/auth.ts) re-reads the DB row behind a
 *  60s Redis cache and is the real authorization boundary. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return getSessionFromCookie(store.getAll());
}
