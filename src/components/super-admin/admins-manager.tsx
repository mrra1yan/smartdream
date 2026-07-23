"use client";

import { useState, useTransition } from "react";
import { ArrowDownToLine, Plus, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { AdminProfile } from "@/lib/types";
import { createAdmin, demoteAdmin } from "@/app/actions/super-admin";
import { CreateAccountForm } from "@/components/super-admin/create-account-form";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import { ConfirmModal } from "@/components/ui/confirm-modal";

export function AdminsManager({ admins }: { admins: AdminProfile[] }) {
  const { t } = useI18n();
  const [isAdding, setIsAdding] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("superAdmin.admins")}</h1>
        </div>
        <Button onClick={() => setIsAdding(true)} variant="accent" size="sm" className="gap-2 capitalize shrink-0 w-full sm:w-auto h-auto py-2.5">
          <Plus className="h-4 w-4" />
          {t("superAdmin.createAdmin")}
        </Button>
      </div>

      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdding(false)}
              className="absolute inset-0 bg-black/60"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-2xl"
            >
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="absolute top-4 right-4 rounded-full p-1.5 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-foreground transition-colors cursor-pointer z-10"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
              
              <h2 className="text-lg font-bold mb-4 capitalize">{t("superAdmin.createAdmin")}</h2>
              <CreateAccountForm 
                create={createAdmin} 
                cta={t("superAdmin.createAdmin")} 
                onSuccess={() => setIsAdding(false)}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {admins.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted col-span-full">{t("superAdmin.noAdmins")}</p>
        ) : (
          admins.map((u) => <AdminRow key={u.id} user={u} />)
        )}
      </div>
    </div>
  );
}

function AdminRow({ user }: { user: AdminProfile }) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  function onConfirmDemote() {
    setShowConfirm(false);
    setError(null);
    startTransition(async () => {
      const res = await demoteAdmin(user.id);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col justify-between gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="min-w-0">
        <p className="truncate text-base font-bold text-foreground">
          {user.firstName} {user.lastName}
        </p>
        <p className="truncate text-sm sm:text-xs text-muted-foreground/80">
          {user.email}
        </p>
        <p className="truncate text-xs sm:text-[10px] text-muted-foreground/60 mt-0.5">
          ID: {user.publicId}
        </p>
      </div>
      <div className="mt-2 pt-2 border-t border-border/40 flex flex-col gap-2">
        <Button
          type="button"
          size="sm"
          variant="danger"
          onClick={() => setShowConfirm(true)}
          disabled={pending}
          className="w-full capitalize h-9 text-xs gap-1.5"
        >
          <ArrowDownToLine className="h-3.5 w-3.5" /> {t("superAdmin.demote")}
        </Button>
        {error ? <p className="text-xs text-danger mt-1">{error}</p> : null}
      </div>

      <ConfirmModal
        open={showConfirm}
        onConfirm={onConfirmDemote}
        onCancel={() => setShowConfirm(false)}
        title={t("superAdmin.demoteConfirm", { email: user.email })}
        confirmLabel={t("superAdmin.demote")}
        cancelLabel={t("common.cancel") || "Cancel"}
        variant="danger"
        loading={pending}
      />
    </div>
  );
}
