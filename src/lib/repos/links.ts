import "server-only";
import { pool, toIso } from "@/lib/db";

/** links table repository. Rows match the old supabase `Link` shape. */

export type LinkRow = {
  id: string;
  user_id: string;
  url: string | null;
  likes_count: number;
  sort_order: number;
  created_at: string;
};

export function mapLinkRow(row: Record<string, unknown>): LinkRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    url: (row.url as string | null) ?? null,
    likes_count: Number(row.likes_count ?? 0),
    sort_order: Number(row.sort_order ?? 0),
    created_at: toIso(row.created_at) ?? "",
  };
}

export async function getLinkById(id: string): Promise<LinkRow | null> {
  const [rows] = await pool.query(
    "SELECT id, user_id, url, likes_count, sort_order, created_at FROM links WHERE id = ? LIMIT 1",
    [id],
  );
  const row = (rows as Record<string, unknown>[])[0];
  return row ? mapLinkRow(row) : null;
}

/** Link owner + owner's boost/elite flags (commitLikeAction's join). */
export async function getLinkOwner(
  linkId: string,
): Promise<{ user_id: string; is_elite: boolean; is_boosted: boolean } | null> {
  const [rows] = await pool.query(
    `SELECT l.user_id, p.is_elite, p.is_boosted
     FROM links l
     JOIN profiles p ON p.id = l.user_id
     WHERE l.id = ? LIMIT 1`,
    [linkId],
  );
  const row = (rows as Record<string, unknown>[])[0];
  if (!row) return null;
  return {
    user_id: String(row.user_id),
    is_elite: Boolean(row.is_elite),
    is_boosted: Boolean(row.is_boosted),
  };
}

export async function getUserLinks(
  userId: string,
): Promise<{ id: string; url: string | null; likes_count: number }[]> {
  const [rows] = await pool.query(
    `SELECT id, url, likes_count FROM links
     WHERE user_id = ? AND sort_order >= 0
     ORDER BY sort_order ASC`,
    [userId],
  );
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    url: (r.url as string | null) ?? null,
    likes_count: Number(r.likes_count ?? 0),
  }));
}

export async function updateLink(
  id: string,
  userId: string,
  url: string,
): Promise<void> {
  await pool.query(
    "UPDATE links SET url = ? WHERE id = ? AND user_id = ?",
    [url, id, userId],
  );
}

/** Soft-delete marker: negative seconds-since-epoch (see actions/links.ts). */
function deletedSortOrder(): number {
  return -Math.floor(Date.now() / 1000);
}

export async function softDeleteLink(id: string, userId: string): Promise<void> {
  await pool.query(
    "UPDATE links SET url = 'https://deleted.local', sort_order = ? WHERE id = ? AND user_id = ?",
    [deletedSortOrder(), id, userId],
  );
}

/** Bulk soft-delete; returns how many rows were actually updated. */
export async function softDeleteLinks(ids: string[], userId: string): Promise<number> {
  if (ids.length === 0) return 0;
  const [result] = await pool.query(
    `UPDATE links SET url = 'https://deleted.local', sort_order = ?
     WHERE user_id = ? AND id IN (${ids.map(() => "?").join(", ")})`,
    [deletedSortOrder(), userId, ...ids],
  );
  return (result as { affectedRows: number }).affectedRows;
}

export async function countActiveLinks(userId: string): Promise<number> {
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS cnt FROM links WHERE user_id = ? AND sort_order >= 0",
    [userId],
  );
  return Number((rows as Record<string, unknown>[])[0]?.cnt ?? 0);
}

/** Active-link count per user (admin "active users" metric). */
export async function countLinksByUserIds(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM links
     WHERE sort_order >= 0 AND user_id IN (${userIds.map(() => "?").join(", ")})`,
    userIds,
  );
  return Number((rows as Record<string, unknown>[])[0]?.cnt ?? 0);
}

/** Hard-delete all links for a user (rejectUser cleanup). */
export async function deleteLinksByUser(userId: string): Promise<void> {
  await pool.query("DELETE FROM links WHERE user_id = ?", [userId]);
}

/** Sum of likes_count per user over their active links (elite dashboards). */
export async function getLikesTotalByUserIds(
  userIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (userIds.length === 0) return map;
  const [rows] = await pool.query(
    `SELECT user_id, SUM(likes_count) AS total FROM links
     WHERE sort_order >= 0 AND user_id IN (${userIds.map(() => "?").join(", ")})
     GROUP BY user_id`,
    userIds,
  );
  for (const r of rows as Record<string, unknown>[]) {
    map.set(String(r.user_id), Number(r.total ?? 0));
  }
  return map;
}
