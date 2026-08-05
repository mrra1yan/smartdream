import "server-only";
import { cache } from "react";
import type { AdminProfile } from "@/lib/types";
import { profileRowToAdmin } from "@/lib/profile-mappers";
import { bangladeshMidnightISO } from "@/lib/timezone";
import {
  countProfiles,
  listProfiles,
} from "@/lib/repos/profiles";
import { getLikesTotalByUserIds } from "@/lib/repos/links";
import { getReceivedTodayByUserIds, listRecentLikesWithProfiles } from "@/lib/repos/likes";
import { listAuditLog } from "@/lib/repos/audit";
import { cacheGet, cacheSet } from "@/lib/redis";

// Super-admin dashboard COUNTs (4 per load) — Redis-cached 30s like the
// plain-admin counts; no explicit invalidation (staleness acceptable).
const SUPER_COUNTS_TTL_SECONDS = 30;

export type EliteUserDetail = AdminProfile & {
  likesReceivedToday: number;
  likesReceivedTotal: number;
};

export const getEliteUsers = cache(async (): Promise<EliteUserDetail[]> => {
  const elites = await listProfiles({ isElite: true });
  if (elites.length === 0) return [];

  const todayStartIso = bangladeshMidnightISO();
  const eliteIds = elites.map((u) => u.id);

  // Bulk-fetch instead of looping per elite user (was 1 + 2N queries).
  const [totalByUser, todayByUser] = await Promise.all([
    getLikesTotalByUserIds(eliteIds),
    getReceivedTodayByUserIds(eliteIds, todayStartIso),
  ]);

  return elites.map((u) => ({
    ...profileRowToAdmin(u),
    likesReceivedToday: todayByUser.get(u.id) ?? 0,
    likesReceivedTotal: totalByUser.get(u.id) ?? 0,
  }));
});

export const getAdmins = cache(async (): Promise<AdminProfile[]> => {
  const rows = await listProfiles({ roleIn: ["admin"], orderBy: "created_at" });
  return rows.map(profileRowToAdmin);
});

export type SuperCounts = {
  elite: number;
  admins: number;
  users: number;
  pending: number;
};

export const getSuperCounts = cache(async (): Promise<SuperCounts> => {
  const cached = await cacheGet<SuperCounts>("super:counts");
  if (cached) return cached;

  const [elite, admins, users, pending] = await Promise.all([
    countProfiles({ isElite: true }),
    countProfiles({ roleIn: ["admin"] }),
    countProfiles({ roleIn: ["user"], status: "approved", isElite: false }),
    countProfiles({ status: "pending", isElite: false }),
  ]);

  const counts = { elite, admins, users, pending };
  await cacheSet("super:counts", counts, SUPER_COUNTS_TTL_SECONDS);
  return counts;
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
    const rows = await listRecentLikesWithProfiles(limit);
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      anonymous: row.is_anonymous,
      likerEmail: row.liker_email,
      likerPublicId: row.liker_public_id,
      receiverEmail: row.receiver_email,
      receiverPublicId: row.receiver_public_id,
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
 * Surfaces `audit_log` rows — the record of privileged admin/super-admin
 * actions. Distinct from `getLikeAudit`, which tracks like activity.
 */
export const getAdminAuditLog = cache(
  async (limit = 200): Promise<AdminAuditEntry[]> => {
    const rows = await listAuditLog(limit);
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      actorEmail: row.actor_email,
      action: row.action,
      targetId: row.target_id,
      metadata: row.metadata,
    }));
  },
);

export const getAllUsersForSuper = cache(
  async (): Promise<AdminProfile[]> => {
    // Safety cap — unbounded before.
    const rows = await listProfiles({
      roleIn: ["user", "admin"],
      orderBy: "created_at",
      limit: 1000,
    });
    return rows.map(profileRowToAdmin);
  },
);

export type EliteUserWithLikes = AdminProfile & {
  likesReceived: number;
};

export const getEliteUsersWithLikes = cache(
  async (): Promise<EliteUserWithLikes[]> => {
    const elites = await listProfiles({ isElite: true });
    if (elites.length === 0) return [];

    const eliteIds = elites.map((u) => u.id);

    // Bulk-fetch instead of looping per elite user.
    const totalByUser = await getLikesTotalByUserIds(eliteIds);

    const res: EliteUserWithLikes[] = elites.map((u) => ({
      ...profileRowToAdmin(u),
      likesReceived: totalByUser.get(u.id) ?? 0,
    }));

    return res.sort((a, b) => b.likesReceived - a.likesReceived);
  },
);
