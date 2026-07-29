import "server-only";
import { cache } from "react";
import { supabase, type Profile } from "@/lib/supabase";
import type { AdminProfile } from "@/lib/types";
import { profileRowToAdmin } from "@/lib/profile-mappers";
import { bangladeshMidnightISO } from "@/lib/timezone";

export type EliteUserDetail = AdminProfile & {
  likesReceivedToday: number;
  likesReceivedTotal: number;
};

export const getEliteUsers = cache(async (): Promise<EliteUserDetail[]> => {
  const { data: elites, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_elite", true);

  if (error || !elites) return [];
  if (elites.length === 0) return [];

  const todayStartIso = bangladeshMidnightISO();
  const eliteIds = elites.map((u) => u.id);

  // Bulk-fetch instead of looping per elite user (was 1 + 2N queries).
  const [{ data: linksRows }, { data: likesRows }] = await Promise.all([
    supabase.from("links").select("user_id, likes_count").in("user_id", eliteIds).gte("sort_order", 0),
    supabase.from("likes").select("receiver_id").in("receiver_id", eliteIds).gte("created_at", todayStartIso),
  ]);

  const totalByUser = new Map<string, number>();
  for (const l of (linksRows as any[] | null) ?? []) {
    totalByUser.set(l.user_id, (totalByUser.get(l.user_id) ?? 0) + l.likes_count);
  }

  const todayByUser = new Map<string, number>();
  for (const l of (likesRows as any[] | null) ?? []) {
    todayByUser.set(l.receiver_id, (todayByUser.get(l.receiver_id) ?? 0) + 1);
  }

  return elites.map((u) => ({
    ...profileRowToAdmin(u as Profile),
    likesReceivedToday: todayByUser.get(u.id) ?? 0,
    likesReceivedTotal: totalByUser.get(u.id) ?? 0,
  }));
});

export const getAdmins = cache(async (): Promise<AdminProfile[]> => {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "admin")
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return (data as Profile[]).map(profileRowToAdmin);
});

export type SuperCounts = {
  elite: number;
  admins: number;
  users: number;
  pending: number;
};

export const getSuperCounts = cache(async (): Promise<SuperCounts> => {
  // Four indexed COUNTs run in parallel instead of pulling every profile
  // row over the wire and counting in JS (see getAdminCounts for the same
  // pattern in the plain-admin dashboard).
  const [elite, admins, users, pending] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_elite", true),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "user").eq("is_elite", false).eq("status", "approved"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending").eq("is_elite", false),
  ]);

  return {
    elite: elite.count ?? 0,
    admins: admins.count ?? 0,
    users: users.count ?? 0,
    pending: pending.count ?? 0,
  };
});

export type AuditEntry = {
  id: string;
  createdAt: string;
  anonymous: boolean;
  likerEmail: string | null;
  likerPublicId: string | null;
  receiverEmail: string | null;
  receiverPublicId: string | null;
};

export const getLikeAudit = cache(
  async (limit = 100): Promise<AuditEntry[]> => {
    const { data, error } = await supabase
      .from("likes")
      .select(`
        id,
        created_at,
        is_anonymous,
        liker:profiles!liker_id(email, public_id),
        receiver:profiles!receiver_id(email, public_id)
      `)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    return (data as any).map((row: any) => ({
      id: row.id,
      createdAt: row.created_at,
      anonymous: row.is_anonymous,
      likerEmail: row.liker?.email ?? null,
      likerPublicId: row.liker?.public_id ?? null,
      receiverEmail: row.receiver?.email ?? null,
      receiverPublicId: row.receiver?.public_id ?? null,
    }));
  },
);

export type AdminAuditEntry = {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorRole: string | null;
  actorEmail: string | null;
  action: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
};

/**
 * Surfaces `public.audit_log` rows (see
 * supabase/migrations/0003_security_hardening.sql for the table, and
 * `@/lib/audit`'s `logAudit` for the writer) — the record of privileged
 * admin/super-admin actions such as promote/demote, elite user
 * create/delete/password-reset, boost/autolike activation, and settings
 * changes. Distinct from `getLikeAudit`, which tracks like activity.
 */
export const getAdminAuditLog = cache(
  async (limit = 200): Promise<AdminAuditEntry[]> => {
    const { data, error } = await supabase
      .from("audit_log")
      .select(`
        id,
        created_at,
        actor_id,
        actor_role,
        action,
        target_id,
        metadata,
        actor:profiles!actor_id(email)
      `)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    return (data as any).map((row: any) => ({
      id: row.id,
      createdAt: row.created_at,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      actorEmail: row.actor?.email ?? null,
      action: row.action,
      targetId: row.target_id,
      metadata: row.metadata,
    }));
  },
);

export const getAllUsersForSuper = cache(
  async (): Promise<AdminProfile[]> => {
    // Safety cap -- unbounded before, would silently get slower (and
    // eventually hit response-size limits) as the user base grows.
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .in("role", ["user", "admin"])
      .order("created_at", { ascending: false })
      .limit(1000);

  if (error || !data) return [];
  return (data as Profile[]).map(profileRowToAdmin);
},
);

export type EliteUserWithLikes = AdminProfile & {
  likesReceived: number;
};

export const getEliteUsersWithLikes = cache(
  async (): Promise<EliteUserWithLikes[]> => {
    const { data: elites, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("is_elite", true);

    if (error || !elites) return [];
    if (elites.length === 0) return [];

    const eliteIds = elites.map((u) => u.id);

    // Bulk-fetch instead of looping per elite user (was 1 + N queries).
    const { data: linksRows } = await supabase
      .from("links")
      .select("user_id, likes_count")
      .in("user_id", eliteIds)
      .gte("sort_order", 0);

    const totalByUser = new Map<string, number>();
    for (const l of (linksRows as any[] | null) ?? []) {
      totalByUser.set(l.user_id, (totalByUser.get(l.user_id) ?? 0) + l.likes_count);
    }

    const res: EliteUserWithLikes[] = elites.map((u) => ({
      ...profileRowToAdmin(u as Profile),
      likesReceived: totalByUser.get(u.id) ?? 0,
    }));

    return res.sort((a, b) => b.likesReceived - a.likesReceived);
  },
);
