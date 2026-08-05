import "server-only";
import { cache } from "react";
import type { AdminProfile } from "@/lib/types";
import { profileRowToAdmin } from "@/lib/profile-mappers";
import { getCurrentUser } from "@/lib/auth";
import { bangladeshMidnightISO } from "@/lib/timezone";
import { getSettings } from "@/lib/settings";
import {
  countProfiles,
  countProfilesByReferredBy,
  getMaxBoostOrder,
  getProfile,
  getProfileMeta,
  getProfilesByIds,
  listProfiles,
  type ProfileRow,
} from "@/lib/repos/profiles";
import {
  countLinksByUserIds,
  getUserLinks as repoGetUserLinks,
} from "@/lib/repos/links";
import {
  countGivenToday,
  countReceivedToday,
  getGivenCountsInWindow,
} from "@/lib/repos/likes";
import { nextBoostOrder as rpcNextBoostOrder, getTopLikers as rpcGetTopLikers } from "@/lib/repos/rpc";
import { cacheGet, cacheSet } from "@/lib/redis";

// Admin dashboard reads are expensive (3-4 COUNTs / a temp-table-filesort
// leaderboard) and change slowly — Redis TTLs absorb repeat dashboard loads.
// No explicit invalidation: 30-60s staleness on admin counts is acceptable.
const ADMIN_COUNTS_TTL_SECONDS = 30;
const TOP_LIKERS_TTL_SECONDS = 60;
// This number feeds the admin dashboard's "active user links" card and is the
// single most expensive unbounded read on that page: it materializes every
// approved user id, then runs a GROUP BY over the likes table for all of them
// in a 24h window. Same staleness budget as the other admin cards.
const ACTIVE_USERS_LINK_COUNT_TTL_SECONDS = 60;

/**
 * Scope guard shared by every admin/super-admin action and read that takes
 * an arbitrary target `userId`: a plain admin may act on/read a normal user,
 * but not an elite user, another admin, or a super_admin — only a
 * super_admin may touch those. Throws when the caller is out of scope.
 */
export async function failIfElite(userId: string): Promise<void> {
  if (userId.startsWith("mock-")) return;
  const me = await getCurrentUser();
  if (me?.role === "super_admin") return;

  const row = await getProfileMeta(userId);
  if (!row) throw new Error("User not found");
  if (row.is_elite || row.role === "super_admin" || row.role === "admin") {
    throw new Error("Not permitted.");
  }
}

export type PendingUserProfile = AdminProfile & {
  referrerName: string | null;
  referrerPublicId: string | null;
};

export type AdminCounts = {
  total: number;
  pending: number;
  admins: number;
};

export const getAdminCounts = cache(async (): Promise<AdminCounts> => {
  const cached = await cacheGet<AdminCounts>("admin:counts");
  if (cached) return cached;

  const [total, pending, admins] = await Promise.all([
    countProfiles({ roleIn: ["user"], status: "approved", isElite: false }),
    countProfiles({ roleIn: ["user", "admin"], status: "pending", isElite: false }),
    countProfiles({ roleIn: ["admin"], isElite: false }),
  ]);

  const counts = { total, pending, admins };
  await cacheSet("admin:counts", counts, ADMIN_COUNTS_TTL_SECONDS);
  return counts;
});

export const getPendingUsers = cache(async (): Promise<PendingUserProfile[]> => {
  // Safety cap — unbounded before, would silently get slower as the pending
  // queue grows.
  const data = await listProfiles({
    roleIn: ["user", "admin"],
    status: "pending",
    isElite: false,
    orderBy: "created_at",
    limit: 1000,
  });

  const referrerIds = [...new Set(data.map((r) => r.referred_by).filter(Boolean))] as string[];
  let referrers: ProfileRow[] = [];
  if (referrerIds.length > 0) {
    // Only ever called from the plain-admin dashboard — elite/super_admin
    // referrers must never resolve here (a pending user who signed up via an
    // elite user's or a super-admin's own referral link would otherwise show
    // that identity directly on the admin dashboard).
    referrers = (await getProfilesByIds(referrerIds)).filter(
      (ref) => !ref.is_elite && ref.role !== "super_admin",
    );
  }

  return data.map((r): PendingUserProfile => {
    const referrer = referrers.find((ref) => ref.id === r.referred_by);
    return {
      ...profileRowToAdmin(r),
      referrerName: referrer ? `${referrer.first_name ?? ""} ${referrer.last_name ?? ""}` : null,
      referrerPublicId: referrer ? referrer.public_id : null,
    };
  });
});

export const getAllUsers = cache(async (): Promise<AdminProfile[]> => {
  const data = await listProfiles({
    roleIn: ["user", "admin"],
    isElite: false,
    orderBy: "created_at",
    limit: 1000,
  });
  return data.map(profileRowToAdmin);
});

export const searchUsers = cache(
  async (query: string): Promise<AdminProfile[]> => {
    const raw = query.trim();
    if (!raw) return [];

    // Sanitize: keep only word chars, spaces, hyphens, @, +, . (safe in LIKE
    // patterns — the old PostgREST filter-injection guard).
    const term = raw.replace(/[^\w\s\-@+.@]/g, "").slice(0, 100);
    if (!term) return [];

    const data = await listProfiles({
      roleIn: ["user", "admin"],
      isElite: false,
      search: term,
      orderBy: "created_at",
      limit: 1000,
    });

    // Post-filter for first_name + last_name concatenation (SQL LIKE can't
    // easily match across two columns).
    const filtered = data.filter((p) => {
      const fullName = `${p.first_name ?? ""} ${p.last_name ?? ""}`.toLowerCase();
      return fullName.includes(term.toLowerCase());
    });

    return filtered.map(profileRowToAdmin);
  },
);

export const getUserForAdmin = cache(
  async (userId: string): Promise<AdminProfile | null> => {
    // IDOR fix: unlike getAllUsers/getPendingUsers/searchUsers (which
    // explicitly exclude elite/non-user-or-admin rows), this previously had
    // no scope check at all. failIfElite self-exempts super_admin callers;
    // a plain admin now sees the same "not found" as if the row didn't exist.
    try {
      await failIfElite(userId);
    } catch {
      return null;
    }

    const row = await getProfile(userId);
    return row ? profileRowToAdmin(row) : null;
  },
);

export type UserLink = {
  id: string;
  url: string;
  likesCount: number;
};

export const getUserLinks = cache(
  async (userId: string): Promise<UserLink[]> => {
    const links = await repoGetUserLinks(userId);
    return links.map((l) => ({
      id: l.id,
      url: l.url ?? "",
      likesCount: l.likes_count,
    }));
  },
);

export type UserStats = {
  givenToday: number;
  receivedToday: number;
};

export const getUserStats = cache(
  async (userId: string): Promise<UserStats> => {
    // Bangladesh-local midnight — see src/lib/timezone.ts. Matches
    // getEliteUsers' boundary and getMyStats', so "today" means the same
    // thing everywhere.
    const todayIso = bangladeshMidnightISO();

    const [givenToday, receivedToday] = await Promise.all([
      countGivenToday(userId, todayIso),
      countReceivedToday(userId, todayIso),
    ]);

    return { givenToday, receivedToday };
  },
);

export type ReferralStats = {
  referredByProfile: AdminProfile | null;
  approvedByProfile: AdminProfile | null;
  totalReferred: number;
};

export const getReferralStats = cache(
  async (userId: string): Promise<ReferralStats> => {
    // Shared by both the plain-admin and super-admin surfaces. A super-admin
    // caller sees everything; anyone else must never learn an elite user's or
    // another super-admin's identity through the referral/approval chain.
    const caller = await getCurrentUser();
    const callerIsSuperAdmin = caller?.role === "super_admin";
    const isHidden = (row: { is_elite?: boolean | null; role?: string | null }) =>
      !callerIsSuperAdmin && (Boolean(row.is_elite) || row.role === "super_admin");

    const user = await getProfile(userId);

    let referredByProfile = null;
    if (user?.referred_by) {
      const ref = await getProfile(user.referred_by);
      referredByProfile = ref && !isHidden(ref) ? profileRowToAdmin(ref) : null;
    }

    let approvedByProfile = null;
    if (user?.approved_by) {
      const approver = await getProfile(user.approved_by);
      approvedByProfile = approver && !isHidden(approver) ? profileRowToAdmin(approver) : null;
    }

    const totalReferred = await countProfilesByReferredBy(userId);

    return {
      referredByProfile,
      approvedByProfile,
      totalReferred,
    };
  },
);

// Backed by the boost_order_seq PostgreSQL sequence. Falls back to the previous non-atomic
// approach if the procedure isn't available, so callers don't hard-fail.
export async function nextBoostOrder(): Promise<number> {
  try {
    const value = await rpcNextBoostOrder();
    if (typeof value === "number" && value > 0) return value;
  } catch (err) {
    console.error("[admin] next_boost_order RPC failed:", (err as Error).message);
  }

  const max = await getMaxBoostOrder();
  return (max ?? 0) + 1;
}

// "Active" here is two layered conditions:
//   1. Same population as `total` in getAdminCounts (role user, approved,
//      non-elite).
//   2. Within the last `activeWindowHours`, the user has GIVEN at least
//      `activeLikeCount` likes — a flat activity threshold.
// Bulk-fetches given counts instead of querying per user to avoid an N+1.
export const getActiveUsersLinkCount = cache(async (): Promise<number> => {
  // Unbounded list of approved user ids + a wide GROUP BY over the likes
  // table: the most expensive read on the admin dashboard. Redis-cached so a
  // repeat dashboard load (or multiple admins) doesn't recompute it. Like the
  // other admin caches there's no explicit invalidation — 60s staleness on an
  // "active users" stat is acceptable.
  const cached = await cacheGet<number>("admin:active_users_link_count");
  if (cached != null) return cached;

  const activeUsers = await listProfiles({
    roleIn: ["user"],
    status: "approved",
    isElite: false,
  });
  if (activeUsers.length === 0) {
    await cacheSet(
      "admin:active_users_link_count",
      0,
      ACTIVE_USERS_LINK_COUNT_TTL_SECONDS,
    );
    return 0;
  }

  const settings = await getSettings();
  const ids = activeUsers.map((u) => u.id);
  const windowIso = new Date(
    Date.now() - settings.activeWindowHours * 3600000,
  ).toISOString();

  const givenInWindow = await getGivenCountsInWindow(ids, windowIso);

  const qualifyingIds = ids.filter(
    (id) => (givenInWindow.get(id) ?? 0) >= settings.activeLikeCount,
  );

  const count = qualifyingIds.length === 0 ? 0 : await countLinksByUserIds(qualifyingIds);
  await cacheSet(
    "admin:active_users_link_count",
    count,
    ACTIVE_USERS_LINK_COUNT_TTL_SECONDS,
  );
  return count;
});

export type TopLiker = {
  id: string;
  publicId: string;
  firstName: string;
  lastName: string;
  email: string;
  likesCount: number;
};

export const getTopLikers = cache(async (limitCount = 5): Promise<TopLiker[]> => {
  // GROUP BY + ORDER BY + LIMIT run in the stored procedure, so only
  // limitCount rows cross the wire. Redis-cached (60s) — the leaderboard
  // involves a temp-table + filesort over all non-elite users.
  const cached = await cacheGet<TopLiker[]>("admin:toplikers");
  if (cached) return cached;

  try {
    const rows = await rpcGetTopLikers(limitCount);
    const likers = rows.map((p) => ({
      id: p.id,
      publicId: p.public_id,
      firstName: p.first_name,
      lastName: p.last_name,
      email: p.email,
      likesCount: Number(p.likes_count) || 0,
    }));
    await cacheSet("admin:toplikers", likers, TOP_LIKERS_TTL_SECONDS);
    return likers;
  } catch (err) {
    console.error("[admin] get_top_likers failed:", (err as Error).message);
    return [];
  }
});
