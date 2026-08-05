import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";

/**
 * GET: used by server-side redirects (e.g. requireUser → redirect("/api/logout")).
 * POST: programmatic client-initiated logouts.
 * Both clear the `sd_session` cookie (was Supabase's signOut()).
 * Origin check prevents cross-site logout CSRF (embedded <img> attacks).
 */
async function handleLogout(request: NextRequest) {
  // ── CSRF protection: reject cross-origin requests ──────────────────
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host && !origin.endsWith(host)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.set(SESSION_COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return response;
}

export async function GET(request: NextRequest) {
  return handleLogout(request);
}

export async function POST(request: NextRequest) {
  return handleLogout(request);
}
