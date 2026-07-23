import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for use in Client Components. RLS-aware: it automatically
 * reads and writes the `sb-<ref>-auth-token` cookies via the browser, so the
 * signed-in user's session is attached to every request.
 *
 * Uses the anon (public) key — never import the service-role key here.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
