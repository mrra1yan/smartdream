import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * GET: used by server-side redirects (e.g. requireUser → redirect("/api/logout")).
 * Adds an Origin check to prevent cross-site logout CSRF attacks where an
 * attacker embeds <img src="https://target.com/api/logout"> to forcibly log
 * out a victim.
 */
export async function GET(request: NextRequest) {
  // ── CSRF protection: reject cross-origin GET requests ──────────────
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && !origin.endsWith(host)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const url = new URL(request.url);
  return NextResponse.redirect(new URL("/login", url.origin));
}

/**
 * POST: alternative for programmatic client-initiated logouts.
 * Same CSRF protection via Origin check.
 */
export async function POST(request: NextRequest) {
  return GET(request);
}
