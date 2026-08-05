import "server-only";
import { pool, toIso } from "@/lib/db";

/** audit_log table repository (privileged admin/super-admin actions). */

export async function insertAuditLog(entry: {
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (id, actor_id, actor_role, action, target_id, metadata)
     VALUES (UUID(), ?, ?, ?, ?, ?)`,
    [
      entry.actor_id ?? null,
      entry.actor_role ?? null,
      entry.action,
      entry.target_id ?? null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    ],
  );
}

export type AdminAuditEntry = {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_role: string | null;
  actor_email: string | null;
  action: string;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
};

export async function listAuditLog(limit = 200): Promise<AdminAuditEntry[]> {
  const [rows] = await pool.query(
    `SELECT a.id, a.created_at, a.actor_id, a.actor_role, a.action, a.target_id, a.metadata,
            actor.email AS actor_email
     FROM audit_log a
     LEFT JOIN profiles actor ON actor.id = a.actor_id
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [limit],
  );
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    created_at: toIso(r.created_at) ?? "",
    actor_id: (r.actor_id as string | null) ?? null,
    actor_role: (r.actor_role as string | null) ?? null,
    actor_email: (r.actor_email as string | null) ?? null,
    action: String(r.action),
    target_id: (r.target_id as string | null) ?? null,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
  }));
}
