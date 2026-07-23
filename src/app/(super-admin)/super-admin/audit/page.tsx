import type { Metadata } from "next";
import { requireSuperAdmin } from "@/lib/auth";
import { getLikeAudit, getAdminAuditLog } from "@/lib/super-admin";
import { getI18n } from "@/lib/i18n";

export const metadata: Metadata = { title: "Audit | Super Admin" };

export default async function AuditPage() {
  await requireSuperAdmin();
  const { t } = await getI18n();
  const dbEntries = await getLikeAudit(200);
  const adminEntries = await getAdminAuditLog(200);

  const entries = dbEntries;

  return (
    <div className="flex flex-col gap-10">
      {/* Admin / super-admin privileged-action audit trail (audit_log table) */}
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-bold">Admin Action Audit</h1>
        {adminEntries.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">No admin actions recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border text-muted bg-surface/80">
                <tr>
                  <th className="p-3">When</th>
                  <th className="p-3">Actor</th>
                  <th className="p-3">Action</th>
                  <th className="p-3">Target</th>
                  <th className="p-3">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {adminEntries.map((e) => (
                  <tr key={e.id} className="border-b border-border/50 last:border-0 hover:bg-surface/90 transition-colors align-top">
                    <td className="p-3 whitespace-nowrap text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3">
                      <span className="font-semibold text-foreground">{e.actorEmail ?? "—"}</span>
                      {e.actorRole && (
                        <span className="block text-[10px] text-muted-foreground/60 mt-0.5">
                          {e.actorRole}
                        </span>
                      )}
                    </td>
                    <td className="p-3 font-mono">{e.action}</td>
                    <td className="p-3 font-mono text-muted-foreground">{e.targetId ?? "—"}</td>
                    <td className="p-3 max-w-xs">
                      {e.metadata ? (
                        <pre className="whitespace-pre-wrap break-all text-[10px] text-muted-foreground">
                          {JSON.stringify(e.metadata)}
                        </pre>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Like activity audit trail (likes table) */}
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-bold">{t("superAdmin.likeAudit")}</h1>
        {entries.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">{t("superAdmin.noLikesYet")}</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border text-muted bg-surface/80">
                <tr>
                  <th className="p-3">{t("superAdmin.when")}</th>
                  <th className="p-3">{t("superAdmin.liker")}</th>
                  <th className="p-3">{t("superAdmin.receiver")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-border/50 last:border-0 hover:bg-surface/90 transition-colors">
                    <td className="p-3 whitespace-nowrap text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3">
                      <span className="font-semibold text-foreground">{e.likerEmail ?? "—"}</span>
                      {e.likerPublicId && (
                        <span className="block text-[10px] text-muted-foreground/60 mt-0.5">
                          ID: {e.likerPublicId}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className="font-semibold text-foreground">{e.receiverEmail ?? "—"}</span>
                      {e.receiverPublicId && (
                        <span className="block text-[10px] text-muted-foreground/60 mt-0.5">
                          ID: {e.receiverPublicId}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
