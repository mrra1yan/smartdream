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
    is_anonymous: row.is_anonymous as boolean,
    is_boosted_like: row.is_boosted_like as boolean,
    created_at: toIso(row.created_at) ?? "",
  };
}

export async function countGivenToday(
  userId: string,
  sinceIso: string,
  includeBoosted = true,
): Promise<number> {
  const boostedFilter = includeBoosted ? "" : "AND NOT is_boosted_like";
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS cnt FROM likes WHERE liker_id = $1 AND created_at >= $2 ${boostedFilter}`,
    [userId, sinceIso],
  );
  return Number(rows[0]?.cnt ?? 0);
}

export async function countReceivedToday(
  userId: string,
  sinceIso: string,
  includeBoosted = true,
): Promise<number> {
  const boostedFilter = includeBoosted ? "" : "AND NOT is_boosted_like";
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS cnt FROM likes WHERE receiver_id = $1 AND created_at >= $2 ${boostedFilter}`,
    [userId, sinceIso],
  );
  return Number(rows[0]?.cnt ?? 0);
}

/** Given-likes count in a window, grouped per liker (admin active metric). */
export async function getGivenCountsInWindow(
  userIds: string[],
  windowIso: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (userIds.length === 0) return map;
  const { rows } = await pool.query(
    `SELECT liker_id, COUNT(*) AS cnt FROM likes
     WHERE NOT is_boosted_like AND created_at >= $1
       AND liker_id = ANY($2)
     GROUP BY liker_id`,
    [windowIso, userIds],
  );
  for (const r of rows) {
    map.set(String(r.liker_id), Number(r.cnt ?? 0));
  }
  return map;
}

/**
 * Raw likes rows for the weekly chart (split queries for index efficiency).
 */
export async function getLikesInRange(
  userId: string,
  startIso: string,
  endIso: string,
): Promise<{ liker_id: string | null; receiver_id: string; created_at: string }[]> {
  const [givenResult, takenResult] = await Promise.all([
    pool.query(
      `SELECT id, liker_id, receiver_id, created_at FROM likes
       WHERE liker_id = $1 AND created_at >= $2 AND created_at <= $3`,
      [userId, startIso, endIso],
    ),
    pool.query(
      `SELECT id, liker_id, receiver_id, created_at FROM likes
       WHERE receiver_id = $1 AND created_at >= $2 AND created_at <= $3`,
      [userId, startIso, endIso],
    ),
  ]);

  const seen = new Set<string>();
  const merged: { liker_id: string | null; receiver_id: string; created_at: string }[] = [];
  for (const r of [...givenResult.rows, ...takenResult.rows]) {
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
  const { rows } = await pool.query(
    `SELECT receiver_id, COUNT(*) AS cnt FROM likes
     WHERE created_at >= $1 AND receiver_id = ANY($2)
     GROUP BY receiver_id`,
    [sinceIso, userIds],
  );
  for (const r of rows) {
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

/** Deletes all likes by a user (rejectUser cleanup). */
export async function deleteLikesByLiker(userId: string): Promise<void> {
  await pool.query("DELETE FROM likes WHERE liker_id = $1", [userId]);
}

export async function deleteLikesByReceiver(userId: string): Promise<void> {
  await pool.query("DELETE FROM likes WHERE receiver_id = $1", [userId]);
}

/** Recent likes with liker/receiver email + public_id (super-admin audit). */
export async function listRecentLikesWithProfiles(
  limit = 100,
): Promise<LikeAuditEntry[]> {
  const { rows } = await pool.query(
    `SELECT lk.id, lk.created_at, lk.is_anonymous,
            liker.email AS liker_email, liker.public_id AS liker_public_id,
            receiver.email AS receiver_email, receiver.public_id AS receiver_public_id
     FROM likes lk
     LEFT JOIN profiles liker ON liker.id = lk.liker_id
     LEFT JOIN profiles receiver ON receiver.id = lk.receiver_id
     ORDER BY lk.created_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: String(r.id),
    created_at: toIso(r.created_at) ?? "",
    is_anonymous: r.is_anonymous as boolean,
    liker_email: (r.liker_email as string | null) ?? null,
    liker_public_id: (r.liker_public_id as string | null) ?? null,
    receiver_email: (r.receiver_email as string | null) ?? null,
    receiver_public_id: (r.receiver_public_id as string | null) ?? null,
  }));
}
