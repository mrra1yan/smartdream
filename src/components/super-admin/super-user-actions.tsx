"use client";

import { useState, useTransition } from "react";
import { ArrowUpToLine, ArrowDownToLine } from "lucide-react";
import type { AdminProfile } from "@/lib/types";
import { demoteAdmin, promoteToAdmin } from "@/app/actions/super-admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/components/i18n-provider";
import { ConfirmModal } from "@/components/ui/confirm-modal";

export function SuperUserActions({ user }: { user: AdminProfile }) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [confirmAction, setConfirmAction] = useState<"promote" | "demote" | null>(null);

  function onConfirm() {
    const action = confirmAction;
    setConfirmAction(null);
    if (!action) return;

    startTransition(async () => {
      if (action === "promote") {
        await promoteToAdmin(user.id);
      } else {
        await demoteAdmin(user.id);
      }
    });
  }

  if (user.role === "super_admin") return null;

  const isPromote = confirmAction === "promote";
  const isDemote = confirmAction === "demote";

  return (
    <Card className="flex flex-col gap-3 p-4 items-center shadow-sm">
      <div className="text-center text-sm font-bold uppercase text-muted-foreground/80">
        {user.role === "admin" ? t("nav.admin") : t("nav.users")}
      </div>
      <div className="w-full flex justify-center mt-1">
        {user.role === "admin" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setConfirmAction("demote")}
            disabled={pending}
            className="w-full max-w-[200px] border-red-500 text-red-500 hover:bg-red-500 hover:text-white transition-colors capitalize h-9 text-xs font-bold gap-1.5"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" /> {t("superAdmin.demote")}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setConfirmAction("promote")}
            disabled={pending}
            className="w-full max-w-[200px] border-red-500 text-red-500 hover:bg-red-500 hover:text-white transition-colors capitalize h-9 text-xs font-bold gap-1.5"
          >
            <ArrowUpToLine className="h-3.5 w-3.5" /> {t("superAdmin.promote")}
          </Button>
        )}
      </div>

      <ConfirmModal
        open={isPromote}
        onConfirm={onConfirm}
        onCancel={() => setConfirmAction(null)}
        title={t("superAdmin.promoteConfirm", { email: user.email })}
        confirmLabel={t("superAdmin.promote")}
        cancelLabel={t("common.cancel") || "Cancel"}
        variant="warning"
        loading={pending}
      />

      <ConfirmModal
        open={isDemote}
        onConfirm={onConfirm}
        onCancel={() => setConfirmAction(null)}
        title={t("superAdmin.demoteConfirm", { email: user.email })}
        confirmLabel={t("superAdmin.demote")}
        cancelLabel={t("common.cancel") || "Cancel"}
        variant="danger"
        loading={pending}
      />
    </Card>
  );
}
