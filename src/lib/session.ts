import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Thin session shim over Supabase Auth.
 *
 * The previous hand-rolled auth kept a jose-signed JWT in the `session`
 * cookie and exposed `{ sub, role, status }` from it. Auth now lives in
 * Supabase (`@supabase/ssr`), but several server modules (`autolike.ts`,
 * `stats.ts`) still call `getSession()` to resolve the current user id.
 *
 * This shim preserves that API by reading the Supabase session + the mirrored
 * `profiles` row. It performs one DB lookup, so prefer `getCurrentUser()` in
 * `auth.ts` (React-cached) when you need the full profile.
 */

export type SessionPayload = {
  sub: string; // userId (== auth.users.id)
  role: "user" | "admin" | "super_admin";
  status: "pending" | "approved" | "rejected";
};

/** Returns the active session payload, or null when there is no signed-in user. */
export async function getSession(): Promise<SessionPayload | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // role / status are mirrored into the user's metadata by the DB trigger
  // (see supabase/migrations/0001_supabase_auth.sql). Fall back to a DB read
  // if they are not present yet (e.g. users created before the trigger ran).
  const role = (user.user_metadata?.role as SessionPayload["role"]) ?? "user";
  const status =
    (user.user_metadata?.status as SessionPayload["status"]) ?? "pending";

  return { sub: user.id, role, status };
}
