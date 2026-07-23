import "server-only";
import { supabase } from "@/lib/supabase";

export type AuditActor = { id: string; role: string } | null | undefined;

/**
 * Records one row in `public.audit_log` for a privileged admin/super-admin
 * action (see `supabase/migrations/0003_security_hardening.sql` for the
 * table + RLS policy: only the service-role client can write to it).
 *
 * This is intentionally fire-and-forget from the caller's point of view —
 * a failure to write the audit trail must never block, throw from, or roll
 * back an admin action that has already succeeded. Errors are logged and
 * swallowed here so callers can just `await logAudit(...)` without try/catch.
 */
export async function logAudit(
  actor: AuditActor,
  action: string,
  targetId?: string | null,
  metadata?: Record<string, unknown> | null,
): Promise<void> {
  try {
    const { error } = await supabase.from("audit_log").insert({
      actor_id: actor?.id ?? null,
      actor_role: actor?.role ?? null,
      action,
      target_id: targetId ?? null,
      metadata: metadata ?? null,
    });

    if (error) {
      console.error(`[AUDIT] Failed to record action "${action}":`, error);
    }
  } catch (err) {
    console.error(`[AUDIT] Unexpected error recording action "${action}":`, err);
  }
}
