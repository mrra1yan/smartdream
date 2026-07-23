import "server-only";
import { cache } from "react";
import { supabase, type Profile } from "@/lib/supabase";
import type { AdminProfile } from "@/lib/types";
import { profileRowToAdmin } from "@/lib/profile-mappers";
import { getCurrentUser } from "@/lib/auth";
import { bangladeshMidnightISO } from "@/lib/timezone";
import { getSettings } from "@/lib/settings";

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

  const { data } = await supabase
    .from("profiles")
    .select("is_elite, role")
    .eq("id", userId)
    .single();

  const row = data as { is_elite: boolean; role: string } | null;
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
  const { data, error } = await supabase
    .from("profiles")
    .select("role, status, is_elite");

  if (error || !data) {
    return { total: 0, pending: 0, admins: 0 };
  }

  const all = data as { role: string; status: string; is_elite: boolean }[];
  const total = all.filter((p) => p.role === "user" && p.status === "approved" && !p.is_elite).length;
  const pending = all.filter((p) => p.status === "pending" && (p.role === "user" || p.role === "admin") && !p.is_elite).length;
  const admins = all.filter((p) => p.role === "admin" && !p.is_elite).length;

  return { total, pending, admins };
});

export const getPendingUsers = cache(async (): Promise<PendingUserProfile[]> => {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("status", "pending")
    .eq("is_elite", false)
    .in("role", ["user", "admin"])
    .order("created_at", { ascending: false });

  if (error || !data) {
    console.error("getPendingUsers error:", error);
    return [];
  }

  const referrerIds = [...new Set(data.map((r: any) => r.referred_by).filter(Boolean))];
  let referrers: any[] = [];
  if (referrerIds.length > 0) {
    // This is only ever called from the plain-admin dashboard (see
    // src/app/(admin)/admin/page.tsx) -- never from a super-admin surface --
    // so elite/super_admin referrers must never resolve here. Without this,
    // a pending user who signed up via an elite user's or a super-admin's
    // own referral link (both have working /profile referral links, same as
    // any other account) would show that elite/super-admin's real name
    // directly on the admin dashboard.
    const { data: refData } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, public_id")
      .in("id", referrerIds)
      .eq("is_elite", false)
      .neq("role", "super_admin");
    referrers = refData || [];
  }

  return (data as any).map((r: any): PendingUserProfile => {
    const referrer = referrers.find((ref) => ref.id === r.referred_by);
    return {
      ...profileRowToAdmin(r as Profile),
      referrerName: referrer ? `${referrer.first_name} ${referrer.last_name}` : null,
      referrerPublicId: referrer ? referrer.public_id : null,
    };
  });
});

export const getAllUsers = cache(async (): Promise<AdminProfile[]> => {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_elite", false)
    .in("role", ["user", "admin"])
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return (data as Profile[]).map(profileRowToAdmin);
});

export const searchUsers = cache(
  async (query: string): Promise<AdminProfile[]> => {
    const term = query.trim();
    if (!term) return [];

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("is_elite", false)
      .in("role", ["user", "admin"])
      .or(`public_id.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`)
      .order("created_at", { ascending: false });

    if (error || !data) return [];

    // Post-filter for first_name + last_name concatenation since Supabase
    // doesn't support concatenation in .or() easily
    const filtered = data.filter((p: any) => {
      const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
      return fullName.includes(term.toLowerCase());
    });

    return (filtered as Profile[]).map(profileRowToAdmin);
  },
);

export const getUserForAdmin = cache(
  async (userId: string): Promise<AdminProfile | null> => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error || !data) return null;

    // IDOR fix: unlike getAllUsers/getPendingUsers/searchUsers (which
    // explicitly exclude elite/non-user-or-admin rows), this previously had
    // no scope check at all, so a plain admin could pull a super-admin's or
    // an elite user's full profile just by knowing/guessing their UUID.
    // `failIfElite` self-exempts super_admin callers, so /super-admin/users
    // is unaffected; a plain admin now sees the same "not found" as if the
    // row didn't exist, rather than a distinguishable permission error.
    try {
      await failIfElite(userId);
    } catch {
      return null;
    }

    return profileRowToAdmin(data as Profile);
  },
);

export type UserLink = {
  id: string;
  url: string;
  likesCount: number;
};

export const getUserLinks = cache(
  async (userId: string): Promise<UserLink[]> => {
    const { data, error } = await supabase
      .from("links")
      .select("id, url, likes_count")
      .eq("user_id", userId)
      .gte("sort_order", 0)
      .order("sort_order", { ascending: true });

    if (error || !data) return [];
    return (data as any).map((l: any) => ({
      id: l.id,
      url: l.url,
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
    // Bangladesh-local midnight, not server-local (UTC) midnight -- see
    // src/lib/timezone.ts. Matches getEliteUsers' boundary below and
    // getMyStats' (src/lib/stats.ts), so "today" means the same thing
    // everywhere a user or admin can see it.
    const todayIso = bangladeshMidnightISO();

    const [givenToday, receivedToday] =
      await Promise.all([
        supabase.from("likes").select("*", { count: "exact", head: true }).eq("liker_id", userId).gte("created_at", todayIso),
        supabase.from("likes").select("*", { count: "exact", head: true }).eq("receiver_id", userId).gte("created_at", todayIso),
      ]);

    return {
      givenToday: givenToday.count ?? 0,
      receivedToday: receivedToday.count ?? 0,
    };
  },
);

export type ReferralStats = {
  referredByProfile: AdminProfile | null;
  approvedByProfile: AdminProfile | null;
  totalReferred: number;
};

export const getReferralStats = cache(
  async (userId: string): Promise<ReferralStats> => {
    // Shared by both the plain-admin (getSelectedUserReferrals) and
    // super-admin (getUserReferralStats) surfaces. A super-admin caller sees
    // everything; anyone else must never learn an elite user's or another
    // super-admin's identity through the referral/approval chain -- e.g. a
    // regular user approved by a super-admin (staff can approve anyone), or
    // one who signed up via an elite user's own /profile referral link.
    // failIfElite already stops a plain admin from opening an elite/
    // super-admin profile directly; this closes the side-channel where that
    // same identity would otherwise leak through someone ELSE's referral
    // chain instead.
    const caller = await getCurrentUser();
    const callerIsSuperAdmin = caller?.role === "super_admin";
    const isHidden = (row: { is_elite?: boolean | null; role?: string | null }) =>
      !callerIsSuperAdmin && (Boolean(row.is_elite) || row.role === "super_admin");

    const { data: user } = await supabase
      .from("profiles")
      .select("referred_by, approved_by")
      .eq("id", userId)
      .single();

    let referredByProfile = null;
    if (user?.referred_by) {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.referred_by)
        .single();
      const row = data as Profile | null;
      referredByProfile = row && !isHidden(row) ? profileRowToAdmin(row) : null;
    }

    let approvedByProfile = null;
    if (user?.approved_by) {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.approved_by)
        .single();
      const row = data as Profile | null;
      approvedByProfile = row && !isHidden(row) ? profileRowToAdmin(row) : null;
    }

    const { count } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("referred_by", userId);

    return {
      referredByProfile,
      approvedByProfile,
      totalReferred: count ?? 0,
    };
  },
);

// Backed by the `next_boost_order()` RPC / `public.boost_order_seq`
// sequence (see supabase/migrations/0004_phase2_hardening.sql) for the same
// reason as the near-identical `getNextBoostOrder` in
// @/app/actions/admin.ts: a plain "select max() then update elsewhere" pair
// is racy under concurrent boost activations. Falls back to the previous
// non-atomic approach if the RPC isn't available (e.g. migration not yet
// applied), so callers don't hard-fail.
export async function nextBoostOrder(): Promise<number> {
  const { data: rpcData, error: rpcError } = await supabase.rpc("next_boost_order");
  if (!rpcError && typeof rpcData === "number") {
    return rpcData;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("boost_order")
    .eq("is_boosted", true)
    .order("boost_order", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return 1;
  return (data[0] as any).boost_order + 1;
}

// "Active" here is two layered conditions:
//   1. Same population as `total` in getAdminCounts above (role "user",
//      approved, non-elite) -- kept consistent with the Total Users card.
//   2. Within the last `activeWindowHours` (X), the user has GIVEN at least
//      `activeLikeCount` (Y) likes -- a flat activity threshold, not a
//      comparison against likes received. Users who haven't met it don't
//      have their links counted.
// Bulk-fetches given counts instead of querying per user to avoid an N+1
// pattern (see the "optimize feed queries" fix elsewhere in the app).
export const getActiveUsersLinkCount = cache(async (): Promise<number> => {
  const { data: activeUsers, error: usersError } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "user")
    .eq("status", "approved")
    .eq("is_elite", false);

  if (usersError || !activeUsers || activeUsers.length === 0) return 0;

  const settings = await getSettings();
  const ids = (activeUsers as any[]).map((u) => u.id);
  const windowIso = new Date(
    Date.now() - settings.activeWindowHours * 3600000,
  ).toISOString();

  const { data: givenRows } = await supabase
    .from("likes")
    .select("liker_id")
    .eq("is_boosted_like", false)
    .gte("created_at", windowIso)
    .in("liker_id", ids);

  const givenInWindow = new Map<string, number>();
  for (const row of (givenRows as any[] | null) ?? []) {
    givenInWindow.set(row.liker_id, (givenInWindow.get(row.liker_id) ?? 0) + 1);
  }

  const qualifyingIds = ids.filter(
    (id) => (givenInWindow.get(id) ?? 0) >= settings.activeLikeCount,
  );

  if (qualifyingIds.length === 0) return 0;

  const { count, error } = await supabase
    .from("links")
    .select("*", { count: "exact", head: true })
    .in("user_id", qualifyingIds)
    .gte("sort_order", 0);

  if (error) return 0;
  return count ?? 0;
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
  // Ideally this should be an RPC or SQL View.
  // We fetch profiles with their like counts directly to avoid fetching huge likes tables.
  // Only ever called from the plain-admin dashboard (src/app/(admin)/admin/page.tsx)
  // -- role="user" only, so neither an elite user nor staff (who shouldn't
  // have any recorded likes going forward, see the role check in
  // src/app/actions/like.ts, but may from before it existed) can appear by
  // name in this admin-facing leaderboard.
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, public_id, first_name, last_name, email, is_elite, likes:likes!liker_id(count)")
    .eq("is_elite", false)
    .eq("role", "user");

  if (error || !profiles) return [];

  const parsed = profiles.map((p: any) => ({
    id: p.id,
    publicId: p.public_id,
    firstName: p.first_name,
    lastName: p.last_name,
    email: p.email,
    likesCount: p.likes[0]?.count ?? 0,
  }));

  const sorted = parsed.sort((a, b) => b.likesCount - a.likesCount).slice(0, limitCount);
  return sorted;
});
