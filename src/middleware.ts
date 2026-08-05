import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify, SignJWT } from "jose";
import {
  AUTH_PATHS,
  USER_PATHS,
  ADMIN_PATHS,
  SUPER_ADMIN_PATHS,
  ROLE_HOME,
} from "@/lib/routes";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  type SessionClaims,
} from "@/lib/session-cookie";
import { getJwtSecret } from "@/lib/jwt-secret";

/**
 * Edge middleware.
 *
 * Two responsibilities:
 *   1. Verify the `sd_session` JWT (jose, WebCrypto — edge-safe, zero
 *      network) and slide its expiry when more than half has elapsed.
 *   2. Enforce route guards (auth pages, role/status access) from the JWT
 *      claims, same as before — claims can be ~60s stale after an admin
 *      changes role/status; the real authorization boundary is
 *      getCurrentUser() (src/lib/auth.ts), which re-reads the DB.
 *
 * No DB/Redis here on purpose: Edge runtime has no TCP sockets for
 * pg/ioredis, and the JWT-only fast path is what keeps auth-page loads
 * zero-network.
 */

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function middleware(request: NextRequest) {
  // Preserve the reverse-proxy header injection (Cloudflare in front relies
  // on these).
  const requestHeaders = new Headers(request.headers);
  if (!requestHeaders.has("x-forwarded-proto")) {
    requestHeaders.set("x-forwarded-proto", "https");
  }
  const host = requestHeaders.get("host");
  if (host && !requestHeaders.has("x-forwarded-host")) {
    requestHeaders.set("x-forwarded-host", host);
  }

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // ── Ad-network-friendly security headers ────────────────────────────
  response.headers.set("Referrer-Policy", "origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  response.headers.set("X-XSS-Protection", "0");
  response.headers.set("Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()");

  const pathname = request.nextUrl.pathname;
  const isAuthPath = AUTH_PATHS.some((p) => pathname === p);
  const isProtected = [...USER_PATHS, ...ADMIN_PATHS, ...SUPER_ADMIN_PATHS].some(
    (p) =>
      p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(p + "/"),
  );

  // ── Session extraction (zero-network JWT verify) ────────────────────
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  let session: SessionClaims | null = null;

  if (token) {
    try {
      const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ["HS256"] });
      if (typeof payload.sub === "string") {
        session = {
          sub: payload.sub,
          role: (payload.role as SessionClaims["role"]) ?? "user",
          status: (payload.status as SessionClaims["status"]) ?? "pending",
        };

        // Sliding refresh: re-issue when more than half of the TTL elapsed.
        if (payload.exp && payload.iat) {
          const remaining = payload.exp - Math.floor(Date.now() / 1000);
          const total = payload.exp - payload.iat;
          if (remaining > 0 && total > 0 && remaining < total / 2) {
            const fresh = await reissueToken(token, session);
            if (fresh) {
              response.cookies.set(
                SESSION_COOKIE_NAME,
                fresh,
                sessionCookieOptions(),
              );
            }
          }
        }
      }
    } catch {
      session = null; // invalid/expired token — treated as logged out
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

/** Re-signs a still-valid session with a fresh expiry (sliding refresh). */
async function reissueToken(
  _oldToken: string,
  claims: SessionClaims,
): Promise<string | null> {
  try {
    return new SignJWT({ role: claims.role, status: claims.status } as Record<string, unknown>)
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
      .sign(getJwtSecret());
  } catch {
    return null;
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
