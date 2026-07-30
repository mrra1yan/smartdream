import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  AUTH_PATHS,
  USER_PATHS,
  ADMIN_PATHS,
  SUPER_ADMIN_PATHS,
  ROLE_HOME,
} from "@/lib/routes";

/**
 * Edge middleware.
 *
 * Two responsibilities:
 *   1. Refresh the Supabase auth session on every matched request so that
 *      access tokens are kept fresh (replaces the old sliding JWT cookie).
 *   2. Enforce the application's route guards (auth pages, role/status-based
 *      access) using the `role` + `status` claims mirrored into the user's
 *      JWT by the DB trigger.
 *
 * Everything here runs on the Edge runtime, so only the `@supabase/ssr`
 * cookie client is used (no Node APIs, no service-role key).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type SessionClaims = {
  sub: string;
  role: string;
  status: string;
};

export async function middleware(request: NextRequest) {
  // Preserve the reverse-proxy header injection that the previous middleware
  // performed — Cloudflare in front of the app relies on these.
  const requestHeaders = new Headers(request.headers);
  if (!requestHeaders.has("x-forwarded-proto")) {
    requestHeaders.set("x-forwarded-proto", "https");
  }
  const host = requestHeaders.get("host");
  if (host && !requestHeaders.has("x-forwarded-host")) {
    requestHeaders.set("x-forwarded-host", host);
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // ── Ad-network-friendly security headers ────────────────────────────
  // "origin" tells the browser to send just the origin (not the full path)
  // as the Referer header when loading cross-origin resources like ad
  // iframes. This is the right balance — ad networks can verify the
  // publisher domain without leaking internal page paths.
  response.headers.set("Referrer-Policy", "origin");

  // ── Security headers (defense-in-depth) ──────────────────────────────
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  response.headers.set("X-XSS-Protection", "0");
  // Permissions-Policy: restrict sensitive browser features by default.
  // The embed-frame proxy overrides this for ad iframes specifically.
  response.headers.set("Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()");

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    // Keep this in sync with `createSupabaseServerClient()`
    // (@/lib/supabase/server.ts): without an explicit `httpOnly`/`secure`,
    // `@supabase/ssr` defaults to `httpOnly: false` with no `secure` flag,
    // so a session cookie refreshed here (on token near-expiry) would
    // silently drop back to being readable via client-side `document.cookie`
    // even after the server-client fix. Reading via `request.cookies` below
    // is unaffected by `httpOnly` either way (it comes from the `Cookie`
    // request header, not the browser's JS-facing cookie jar).
    cookieOptions: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Reads the session from the cookie and decodes the JWT locally (no
  // network call).  Using getSession() instead of getUser() avoids
  // MIDDLEWARE_INVOCATION_TIMEOUT on Vercel's Edge Runtime when the
  // Supabase auth server is slow.  Token refresh still happens inside
  // server components via createSupabaseServerClient().
  const {
    data: { session: supabaseSession },
  } = await supabase.auth.getSession();
  const user = supabaseSession?.user ?? null;

  const role = (user?.user_metadata?.role as string | undefined) ?? null;
  const status = (user?.user_metadata?.status as string | undefined) ?? null;
  const session: SessionClaims | null = user
    ? { sub: user.id, role: role ?? "user", status: status ?? "pending" }
    : null;

  const pathname = request.nextUrl.pathname;
  const isAuthPath = AUTH_PATHS.some((p) => pathname === p);
  const isProtected = [...USER_PATHS, ...ADMIN_PATHS, ...SUPER_ADMIN_PATHS].some(
    (p) =>
      p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(p + "/"),
  );

  // Logged in → redirect away from auth pages (only if approved).
  if (session && session.status === "approved" && isAuthPath) {
    const url = request.nextUrl.clone();
    url.pathname = ROLE_HOME[session.role] ?? "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Not logged in → protect (skip auth pages so login/signup render).
  if (!session && isProtected && !isAuthPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // Pending users → redirect to login with pending=1.
  if (session && session.status === "pending" && isProtected && !isAuthPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("pending", "1");
    return NextResponse.redirect(url);
  }

  // Role-based route protection.
  if (session && session.status === "approved") {
    const isAdminPath = ADMIN_PATHS.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    );
    const isSuperAdminPath = SUPER_ADMIN_PATHS.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    );
    const isUserOnlyPath = ["/", "/links", "/stats", "/boosted", "/premium"].some(
      (p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(p + "/")),
    );

    if (session.role === "user" && (isAdminPath || isSuperAdminPath)) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }

    if (session.role === "admin") {
      if (isSuperAdminPath || isUserOnlyPath) {
        const url = request.nextUrl.clone();
        url.pathname = "/admin";
        return NextResponse.redirect(url);
      }
    }

    if (session.role === "super_admin") {
      if (isUserOnlyPath) {
        const url = request.nextUrl.clone();
        url.pathname = "/super-admin";
        return NextResponse.redirect(url);
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
