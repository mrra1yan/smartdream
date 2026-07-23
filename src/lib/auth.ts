import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { supabase, Profile } from "@/lib/supabase";
import { getSession } from "@/lib/session";
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
  boostedOfferCount: number;
  referredBy: string | null;
  approvedBy: string | null;
  createdAt: string;
};

export const getCurrentUser = cache(async (): Promise<SessionProfile | null> => {
  const session = await getSession();
  if (!session) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", session.sub)
    .single();

  if (error || !data) return null;

  const row = data as Profile;
  return {
    id: row.id,
    publicId: row.public_id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    email: row.email,
    role: row.role as Role,
    status: row.status as "pending" | "approved" | "rejected",
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
    boostedOfferCount: row.boosted_offer_count,
    referredBy: row.referred_by,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
  };
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
