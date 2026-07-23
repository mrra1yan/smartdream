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

  const todayStartIso = bangladeshMidnightISO();

  const res: EliteUserDetail[] = [];
  for (const u of elites) {
    const { data: linksList } = await supabase
      .from("links")
      .select("likes_count")
      .eq("user_id", u.id)
      .gte("sort_order", 0);

    const likesReceivedTotal = linksList?.reduce((sum, l) => sum + l.likes_count, 0) || 0;

    const { count: likesReceivedToday } = await supabase
      .from("likes")
      .select("*", { count: "exact", head: true })
      .eq("receiver_id", u.id)
      .gte("created_at", todayStartIso);

    res.push({
      ...profileRowToAdmin(u as Profile),
      likesReceivedToday: likesReceivedToday ?? 0,
      likesReceivedTotal,
    });
  }

  return res;
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
  const { data, error } = await supabase
    .from("profiles")
    .select("is_elite, role, status");

  if (error || !data) {
    return { elite: 0, admins: 0, users: 0, pending: 0 };
  }

  const all = data as { is_elite: boolean; role: string; status: string }[];
  return {
    elite: all.filter((p) => p.is_elite).length,
    admins: all.filter((p) => p.role === "admin").length,
    users: all.filter((p) => p.role === "user" && !p.is_elite && p.status === "approved").length,
    pending: all.filter((p) => p.status === "pending" && !p.is_elite).length,
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
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .in("role", ["user", "admin"])
      .order("created_at", { ascending: false });

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

    const res: EliteUserWithLikes[] = [];
    for (const u of elites) {
      const { data: linksList } = await supabase
        .from("links")
        .select("likes_count")
        .eq("user_id", u.id)
        .gte("sort_order", 0);

      const likesReceived = linksList?.reduce((sum, l) => sum + l.likes_count, 0) || 0;
      res.push({
        ...profileRowToAdmin(u as Profile),
        likesReceived,
      });
    }

    return res.sort((a, b) => b.likesReceived - a.likesReceived);
  },
);
