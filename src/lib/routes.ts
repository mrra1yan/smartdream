/** Centralised route definitions used by the proxy and DAL for guards. */

export const AUTH_PATHS = [
  "/login",
  "/signup",
  "/admin/login",
  "/super-admin/login",
] as const;

/** User-facing app routes (require role=user, status=approved).
 *  how-it-works / terms / faq are PUBLIC (linked from signup) so they live in a
 *  separate public route group and are intentionally not listed here. */
export const USER_PATHS = [
  "/",
  "/profile",
  "/links",
  "/stats",
  "/boosted",
  "/premium",
  "/blog",
] as const;

/** Admin panel routes (require role=admin). */
export const ADMIN_PATHS = ["/admin"] as const;

/** Super-admin panel routes (require role=super_admin). */
export const SUPER_ADMIN_PATHS = ["/super-admin"] as const;

/** Everything that requires *some* authenticated session. */
export const PROTECTED_PATHS = [...USER_PATHS, ...ADMIN_PATHS, ...SUPER_ADMIN_PATHS];

export const ROLE_HOME: Record<string, string> = {
  user: "/",
  admin: "/admin",
  super_admin: "/super-admin",
};

/** Which role is allowed to sign in on a given login route. */
export const LOGIN_ROUTE_ROLE: Record<string, "user" | "admin" | "super_admin"> = {
  "/login": "user",
  "/admin/login": "admin",
  "/super-admin/login": "super_admin",
};
