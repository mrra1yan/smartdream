import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getProfile, type ProfileRow } from "@/lib/repos/profiles";
import { cacheGet, cacheSet } from "@/lib/redis";
import type { AdminProfile, FeatureModel, ProfileStatus, PublicProfile, Role } from "@/lib/types";

export type SessionProfile = {
  id: string;
  publicId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  role: Role;
  status: ProfileStatus;
  isElite: boolean;
  isBoosted: boolean;
  boostOrder: number | null;
  boostModel: FeatureModel;
  boostExpiry: string | null;
  boostQuota: number | null;
  boostUsed: number;
  autoLikeEnabled: boolean;
  autoLikeModel: FeatureModel;
  autoLikeExpiry: string | null;
  autoLikeQuota: number | null;
  autoLikeUsed: number;
  freeAutoLikeUntil: string | null;
  autoLikePaused: boolean;
  autoLikePausedRemainingMinutes: number | null;
  freeAutolikePausedRemainingMinutes: number | null;
  boostedOfferCount: number;
  referredBy: string | null;
  approvedBy: string | null;
  createdAt: string;
};

function rowToSessionProfile(row: ProfileRow): SessionProfile {
  return {
    id: row.id,
    publicId: row.public_id ?? "",
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    role: row.role as Role,
    status: row.status as ProfileStatus,
    isElite: Boolean(row.is_elite),
    isBoosted: Boolean(row.is_boosted),
    boostOrder: row.boost_order,
    boostModel: row.boost_model as FeatureModel,
    boostExpiry: row.boost_expiry,
    boostQuota: row.boost_quota,
    boostUsed: row.boost_used,
    autoLikeEnabled: Boolean(row.auto_like_enabled),
    autoLikeModel: row.auto_like_model as FeatureModel,
    autoLikeExpiry: row.auto_like_expiry,
    autoLikeQuota: row.auto_like_quota,
    autoLikeUsed: row.auto_like_used,
    freeAutoLikeUntil: row.free_autolike_until,
    autoLikePaused: Boolean(row.auto_like_paused),
    autoLikePausedRemainingMinutes: row.auto_like_paused_remaining_minutes,
    freeAutolikePausedRemainingMinutes: row.free_autolike_paused_remaining_minutes,
    boostedOfferCount: row.boosted_offer_count,
    referredBy: row.referred_by,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
  };
}

/**
 * Current user's full profile. React-cached per request, Redis-cached across
 * requests (60s TTL, invalidated on profile writes — see profile-cache.ts).
 * THIS is the real authorization boundary: every require* guard and every
 * privileged action re-reads role/status here, so an admin's changes
 * converge within ~60s even though the middleware's JWT claims are stale.
 */
export const getCurrentUser = cache(async (): Promise<SessionProfile | null> => {
  const session = await getSession();
  if (!session) return null;

  const cached = await cacheGet<SessionProfile>(`profile:${session.sub}`);
  if (cached) return cached;

  const row = await getProfile(session.sub);
  if (!row) return null;

  const profile = rowToSessionProfile(row);
  await cacheSet(`profile:${session.sub}`, profile, 60);
  return profile;
});

export function toPublicProfile(p: SessionProfile): PublicProfile {
  return {
    id: p.id,
    publicId: p.publicId,
    firstName: p.firstName,
    lastName: p.lastName,
    phone: p.phone,
    email: p.email,
    role: p.role,
    status: p.status,
    createdAt: p.createdAt,
  };
}

export function toAdminProfile(p: SessionProfile): AdminProfile {
  return { ...p };
}

export async function requireUser(): Promise<SessionProfile> {
  const user = await getCurrentUser();
  if (!user) redirect("/api/logout");
  if (user.status !== "approved") redirect("/login?pending=1");
  return user;
}

export async function requireAdmin(): Promise<SessionProfile> {
  const user = await getCurrentUser();
  if (!user) redirect("/api/logout");
  if (user.role !== "admin" && user.role !== "super_admin") redirect("/login");
  return user;
}

export async function requireStaff(): Promise<SessionProfile> {
  const user = await getCurrentUser();
  if (!user) redirect("/api/logout");
  if (user.role !== "admin" && user.role !== "super_admin") redirect("/login");
  return user;
}

export async function requireSuperAdmin(): Promise<SessionProfile> {
  const user = await getCurrentUser();
  if (!user) redirect("/api/logout");
  if (user.role !== "super_admin") redirect("/login");
  return user;
}
