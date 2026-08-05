import "server-only";
import { insertAuditLog as repoInsertAuditLog } from "@/lib/repos/audit";

export type AuditActor = { id: string; role: string } | null | undefined;

/**
 * Records one row in `audit_log` for a privileged admin/super-admin action.
 * Fire-and-forget from the caller's point of view — a failure to write the
 * audit trail must never block, throw from, or roll back an admin action
 * that has already succeeded. Errors are logged and swallowed here.
 */
export async function logAudit(
  actor: AuditActor,
  action: string,
  targetId?: string | null,
  metadata?: Record<string, unknown> | null,
): Promise<void> {
  try {
    await repoInsertAuditLog({
      actor_id: actor?.id ?? null,
      actor_role: actor?.role ?? null,
      action,
      target_id: targetId ?? null,
      metadata: metadata ?? null,
    });
  } catch (err) {
    console.error(`[AUDIT] Unexpected error recording action "${action}":`, err);
  }
}
