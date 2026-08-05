import "server-only";
import { pool, toIso } from "@/lib/db";

/** likes table repository. */

export type LikeRow = {
  id: string;
  liker_id: string | null;
  link_id: string | null;
  receiver_id: string;
  is_anonymous: boolean;
  is_boosted_like: boolean;
  created_at: string;
};

export function mapLikeRow(row: Record<string, unknown>): LikeRow {
  return {
    id: String(row.id),
    liker_id: (row.liker_id as string | null) ?? null,
    link_id: (row.link_id as string | null) ?? null,
    receiver_id: String(row.receiver_id),
    is_anonymous: Boolean(row.is_anonymous),
    is_boosted_like: Boolean(row.is_boosted_like),
    created_at: toIso(row.created_at) ?? "",
  };
}

export async function countGivenToday(
  userId: string,
  sinceIso: string,
  includeBoosted = true,
): Promise<number> {
  const boostedFilter = includeBoosted ? "" : "AND NOT (is_boosted_like <=> 1)";
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM likes WHERE liker_id = ? AND created_at >= ? ${boostedFilter}`,
    [userId, sinceIso],
  );
  return Number((rows as Record<string, unknown>[])[0]?.cnt ?? 0);
}

export async function countReceivedToday(
  userId: string,
  sinceIso: string,
  includeBoosted = true,
): Promise<number> {
  const boostedFilter = includeBoosted ? "" : "AND NOT (is_boosted_like <=> 1)";
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM likes WHERE receiver_id = ? AND created_at >= ? ${boostedFilter}`,
    [userId, sinceIso],
  );
  return Number((rows as Record<string, unknown>[])[0]?.cnt ?? 0);
}

/** Given-likes count in a window, grouped per liker (admin active metric). */
export async function getGivenCountsInWindow(
  userIds: string[],
  windowIso: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (userIds.length === 0) return map;
  const [rows] = await pool.query(
    `SELECT liker_id, COUNT(*) AS cnt FROM likes
     WHERE is_boosted_like = 0 AND created_at >= ?
       AND liker_id IN (${userIds.map(() => "?").join(", ")})
     GROUP BY liker_id`,
    [windowIso, ...userIds],
  );
  for (const r of rows as Record<string, unknown>[]) {
    map.set(String(r.liker_id), Number(r.cnt ?? 0));
  }
  return map;
}

/**
 * Raw likes rows for the weekly chart (bucketed by BD-local day in JS).
 *
 * The old single query used `(liker_id = ? OR receiver_id = ?)` over a
 * created_at range — an OR across two columns that NO single index can serve
 * (full scan). Split into two index-range queries:
 *   - given:  idx_likes_liker_created_at   (liker_id =, created_at range)
 *   - taken:  idx_likes_receiver_created_at (receiver_id =, created_at range)
 * Merged and deduped by row id. Chart bucketing (actions/chart.ts) counts a
 * self-like row once per side, identical to the old OR + double-if behavior.
 */
export async function getLikesInRange(
  userId: string,
  startIso: string,
  endIso: string,
): Promise<{ liker_id: string | null; receiver_id: string; created_at: string }[]> {
  const [givenRows, takenRows] = await Promise.all([
    pool.query(
      `SELECT id, liker_id, receiver_id, created_at FROM likes
       WHERE liker_id = ? AND created_at >= ? AND created_at <= ?`,
      [userId, startIso, endIso],
    ),
    pool.query(
      `SELECT id, liker_id, receiver_id, created_at FROM likes
       WHERE receiver_id = ? AND created_at >= ? AND created_at <= ?`,
      [userId, startIso, endIso],
    ),
  ]);

  const seen = new Set<string>();
  const merged: { liker_id: string | null; receiver_id: string; created_at: string }[] = [];
  const given = givenRows as unknown as Record<string, unknown>[];
  const taken = takenRows as unknown as Record<string, unknown>[];
  for (const r of [...given, ...taken]) {
    if (seen.has(String(r.id))) continue;
    seen.add(String(r.id));
    merged.push({
      liker_id: (r.liker_id as string | null) ?? null,
      receiver_id: String(r.receiver_id),
      created_at: toIso(r.created_at) ?? "",
    });
  }
  return merged;
}

/** Received-likes today, grouped per receiver (elite dashboard). */
export async function getReceivedTodayByUserIds(
  userIds: string[],
  sinceIso: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (userIds.length === 0) return map;
  const [rows] = await pool.query(
    `SELECT receiver_id, COUNT(*) AS cnt FROM likes
     WHERE created_at >= ? AND receiver_id IN (${userIds.map(() => "?").join(", ")})
     GROUP BY receiver_id`,
    [sinceIso, ...userIds],
  );
  for (const r of rows as Record<string, unknown>[]) {
    map.set(String(r.receiver_id), Number(r.cnt ?? 0));
  }
  return map;
}

export type LikeAuditEntry = {
  id: string;
  created_at: string;
  is_anonymous: boolean;
  liker_email: string | null;
  liker_public_id: string | null;
  receiver_email: string | null;
  receiver_public_id: string | null;
};

/** Deletes all likes by/for a user (rejectUser cleanup). */
export async function deleteLikesByLiker(userId: string): Promise<void> {
  await pool.query("DELETE FROM likes WHERE liker_id = ?", [userId]);
}

export async function deleteLikesByReceiver(userId: string): Promise<void> {
  await pool.query("DELETE FROM likes WHERE receiver_id = ?", [userId]);
}

/** Recent likes with liker/receiver email + public_id (super-admin audit). */
export async function listRecentLikesWithProfiles(
  limit = 100,
): Promise<LikeAuditEntry[]> {
  const [rows] = await pool.query(
    `SELECT lk.id, lk.created_at, lk.is_anonymous,
            liker.email AS liker_email, liker.public_id AS liker_public_id,
            receiver.email AS receiver_email, receiver.public_id AS receiver_public_id
     FROM likes lk
     LEFT JOIN profiles liker ON liker.id = lk.liker_id
     LEFT JOIN profiles receiver ON receiver.id = lk.receiver_id
     ORDER BY lk.created_at DESC
     LIMIT ?`,
    [limit],
  );
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    created_at: toIso(r.created_at) ?? "",
    is_anonymous: Boolean(r.is_anonymous),
    liker_email: (r.liker_email as string | null) ?? null,
    liker_public_id: (r.liker_public_id as string | null) ?? null,
    receiver_email: (r.receiver_email as string | null) ?? null,
    receiver_public_id: (r.receiver_public_id as string | null) ?? null,
  }));
}
