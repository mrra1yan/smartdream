import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Thin session shim over Supabase Auth.
 *
 * Previously used `supabase.auth.getUser()` which ALWAYS makes a network
 * round-trip to Supabase Auth (200ms–2s). Now uses `getSession()` which reads
 * the session from cookies and only makes a network call when the token is
 * expired and needs refresh — making the common case (valid token) instant.
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
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) return null;

  const user = session.user;

  // role / status are mirrored into the user's metadata by the DB trigger
  // (see supabase/migrations/0001_supabase_auth.sql). Fall back to defaults
  // if they are not present yet (e.g. users created before the trigger ran).
  const role = (user.user_metadata?.role as SessionPayload["role"]) ?? "user";
  const status =
    (user.user_metadata?.status as SessionPayload["status"]) ?? "pending";

  return { sub: user.id, role, status };
});
