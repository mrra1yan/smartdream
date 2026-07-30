import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  AUTH_PATHS,
  USER_PATHS,
  ADMIN_PATHS,
  SUPER_ADMIN_PATHS,
  ROLE_HOME,
} from "@/lib/routes";
import { getSessionFromCookie, type SessionClaims } from "@/lib/session-cookie";

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

  const pathname = request.nextUrl.pathname;
  const isAuthPath = AUTH_PATHS.some((p) => pathname === p);
  const isProtected = [...USER_PATHS, ...ADMIN_PATHS, ...SUPER_ADMIN_PATHS].some(
    (p) =>
      p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(p + "/"),
  );

  // ── Session extraction ─────────────────────────────────────────────
  // For auth pages (login, signup, etc.) we only need to know if the user
  // is already signed in — a zero-network JWT decode from the cookie is
  // instant and sufficient. Avoiding the full `getSession()` (which may
  // trigger a network call to Supabase Auth) saves up to 800ms on login
  // page loads — the primary entry point for mobile WebView users.
  //
  // For protected pages we still do the full session refresh (with the
  // 800ms timeout safety net) so expired tokens get renewed.
  let session: SessionClaims | null = null;

  if (isAuthPath) {
    // Fast path: instant cookie decode, no Supabase network call.
    session = getSessionFromCookie(request.cookies.getAll());
  } else if (isProtected) {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      // Keep in sync with `createSupabaseServerClient()`
      // (@/lib/supabase/server.ts).
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

    const cookieCount = request.cookies.getAll().length;
    const hasAuthCookies = request.cookies.getAll().some((c) => c.name.startsWith("sb-"));

    try {
      const { data: { session: supabaseSession } } = await Promise.race([
        supabase.auth.getSession(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("getSession timeout")), 800),
        ),
      ]);
      const user = supabaseSession?.user ?? null;
      if (user) {
        const role = (user.user_metadata?.role as string | undefined) ?? null;
        const status = (user.user_metadata?.status as string | undefined) ?? null;
        session = { sub: user.id, role: role ?? "user", status: status ?? "pending" };
        console.log("[MIDDLEWARE] getSession success — user:", user.id.slice(0, 8), "role:", role, "status:", status, "path:", pathname);
      } else {
        console.log("[MIDDLEWARE] getSession returned null session — cookies:", cookieCount, "hasAuthCookies:", hasAuthCookies, "path:", pathname);
      }
    } catch {
      // getSession() timed out — fall back to direct JWT decode.
      console.log("[MIDDLEWARE] getSession timeout — falling back to cookie decode. cookies:", cookieCount, "hasAuthCookies:", hasAuthCookies, "path:", pathname);
      session = getSessionFromCookie(request.cookies.getAll());
      if (session) {
        console.log("[MIDDLEWARE] Cookie decode fallback success — user:", session.sub.slice(0, 8), "role:", session.role);
      } else {
        console.log("[MIDDLEWARE] Cookie decode fallback returned null — no session");
      }
    }
  }

  if (isProtected && !session) {
    console.log("[MIDDLEWARE] No session on protected route — redirecting to /login. path:", pathname);
  }

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
