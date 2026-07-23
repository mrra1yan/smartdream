import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Supabase client for use inside Next.js server components, server actions
 * and route handlers. It is **RLS-aware**: requests are scoped to the
 * authenticated user whose session cookie is on the request.
 *
 * `@supabase/ssr` manages the `sb-<ref>-auth-token` cookie pair itself. We
 * wire `getAll`/`setAll` to the Next.js `cookies()` store so that token
 * refreshes performed on the server are written back to the response.
 *
 * IMPORTANT: a new client must be created per request (this function is not
 * cached) because `cookies()` is request-scoped. Call it directly where you
 * need it — the module boundary ensures the server bundle.
 */
export async function createSupabaseServerClient() {
  const store = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // `@supabase/ssr`'s DEFAULT_COOKIE_OPTIONS sets `httpOnly: false` and
      // no `secure` flag, which means the session cookie is readable via
      // `document.cookie` from any client-side JS (e.g. an XSS payload) and
      // can be sent over plain HTTP. Server-side code (middleware.ts,
      // getSession()/getCurrentUser(), route handlers) reads cookies from
      // the request's `Cookie` header via `store.getAll()` /
      // `request.cookies.getAll()`, which works identically regardless of
      // `httpOnly` — only client-JS `document.cookie` access is affected —
      // so this does not break any server-side session read in the app.
      cookieOptions: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      },
      cookies: {
        getAll() {
          return store.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              store.set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component where
            // cookies cannot be set. This can safely be ignored if middleware
            // is configured to refresh sessions — which it is.
          }
        },
      },
    },
  );
}
