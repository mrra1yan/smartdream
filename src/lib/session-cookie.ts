/**
 * Fast, zero-network session extraction from Supabase auth cookies.
 *
 * Decodes the JWT payload directly — no token refresh, no HTTP calls.
 * Used both in middleware (route guards) and server components (session lookup)
 * to eliminate redundant network round-trips to Supabase Auth.
 *
 * The role/status claims in an expired JWT are still valid for route-guard /
 * session-lookup decisions — only the *signature* is stale, which this
 * function never verifies anyway. The real auth boundary is RLS + the profile
 * DB query in getCurrentUser().
 *
 * Works with:
 *   - Middleware:     getSessionFromCookie(request.cookies.getAll())
 *   - Server components / route handlers:  getSessionFromCookie((await cookies()).getAll())
 */

export type SessionClaims = {
  sub: string;
  role: string;
  status: string;
};

export function getSessionFromCookie(
  cookies: { name: string; value: string }[],
): SessionClaims | null {
  // @supabase/ssr stores the session in chunked cookies:
  //   sb-<ref>-auth-token.0, sb-<ref>-auth-token.1, ...
  // or a single sb-<ref>-auth-token for small payloads.
  const authCookies = cookies
    .filter((c) => c.name.match(/^sb-.*-auth-token/))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (authCookies.length === 0) return null;

  const fullValue = authCookies.map((c) => c.value).join("");

  try {
    const session = JSON.parse(fullValue);
    const accessToken: string | undefined = session?.access_token;
    if (!accessToken) return null;

    // Decode the JWT payload (base64url → JSON). No signature verification
    // needed — see docstring above.
    const parts = accessToken.split(".");
    if (parts.length !== 3) return null;

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "=",
    );
    const payload = JSON.parse(atob(padded));

    const sub: string | undefined = payload.sub;
    if (!sub) return null;

    const role = (payload.user_metadata?.role as string) ?? "user";
    const status = (payload.user_metadata?.status as string) ?? "pending";

    return { sub, role, status };
  } catch {
    return null;
  }
}
