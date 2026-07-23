"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

// The session cookie is deliberately httpOnly (see createSupabaseServerClient
// / middleware.ts) so client-side JS can never read it via `document.cookie`
// -- that's also exactly how `createSupabaseBrowserClient()` normally
// hydrates its session, so with an httpOnly cookie it never finds one and
// every browser-side Realtime subscription silently authenticates as the
// anon key instead of the signed-in user. RLS then hides every row from
// `postgres_changes` (e.g. `likes_select_own_or_public` requires
// `auth.uid()`), so given/received counters and any other client-side
// realtime subscription never receive events despite the publication and
// RLS policies themselves being correct.
//
// This exposes just the short-lived access_token on demand (read
// server-side, where the httpOnly cookie IS readable) so client components
// can call `supabase.realtime.setAuth(token)` before subscribing, without
// making the session cookie itself readable/exfiltratable via `document.cookie`.
export async function getRealtimeAccessToken(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
