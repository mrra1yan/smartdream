"use client";

import { useState, useTransition } from "react";
import { KeyRound, Trash2, Plus, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { EliteUserDetail } from "@/lib/super-admin";
import { createEliteUser, deleteEliteUser, resetElitePassword } from "@/app/actions/super-admin";
import { CreateAccountForm } from "@/components/super-admin/create-account-form";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { useI18n } from "@/components/i18n-provider";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";

export function EliteManager({ elite }: { elite: EliteUserDetail[] }) {
  const { t } = useI18n();
  const [isAdding, setIsAdding] = useState(false);
  
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("superAdmin.eliteUsers")}</h1>
          <p className="text-xs text-muted mt-1 max-w-2xl">
            {t("superAdmin.eliteDesc")}
          </p>
        </div>
        <Button onClick={() => setIsAdding(true)} variant="accent" size="sm" className="gap-2 capitalize shrink-0 w-full sm:w-auto h-auto py-2.5">
          <Plus className="h-4 w-4" />
          {t("superAdmin.createElite")}
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
              
              <h2 className="text-lg font-bold mb-4 capitalize">{t("superAdmin.createElite")}</h2>
              <CreateAccountForm 
                create={createEliteUser} 
                cta={t("superAdmin.createElite")} 
                onSuccess={() => setIsAdding(false)}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <EliteList elite={elite} />
    </div>
  );
}

function EliteList({ elite }: { elite: EliteUserDetail[] }) {
  const { t } = useI18n();
  if (elite.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">{t("superAdmin.noEliteUsers")}</p>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {elite.map((u) => (
        <EliteRow key={u.id} user={u} />
      ))}
    </div>
  );
}

function EliteRow({ user }: { user: EliteUserDetail }) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  function onDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteEliteUser(user.id);
      if (res.error) {
        setError(res.error);
      } else {
        setShowDeleteModal(false);
      }
    });
  }

  function onReset() {
    setError(null);
    if (pw.length < 8) return;
    startTransition(async () => {
      const res = await resetElitePassword(user.id, pw);
      if (res.error) setError(res.error);
      else setPw("");
    });
  }

  return (
    <div className="flex flex-col justify-between gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
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
        <Button
          type="button"
          size="sm"
          variant="danger"
          onClick={() => setShowDeleteModal(true)}
          disabled={pending}
          className="h-8 w-8 rounded-lg p-0 flex items-center justify-center shrink-0"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Stats Section */}
      <div className="mt-1 grid grid-cols-2 gap-2 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 p-2.5 text-xs border border-border/20">
        <div className="flex flex-col">
          <span className="text-[10px] font-bold text-muted-foreground uppercase">{t("superAdmin.likesToday")}</span>
          <span className="font-extrabold text-foreground text-sm mt-0.5">{user.likesReceivedToday}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-bold text-muted-foreground uppercase">{t("superAdmin.totalLikes")}</span>
          <span className="font-extrabold text-foreground text-sm mt-0.5">{user.likesReceivedTotal}</span>
        </div>
      </div>

      <div className="mt-2 pt-2 border-t border-border/40 flex flex-col gap-2.5">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase text-muted-foreground/75">
            {t("superAdmin.newPassword")}
          </label>
          <PasswordInput
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder={t("superAdmin.minChars")}
            className="!h-8.5 w-full !rounded-lg !text-xs placeholder:!text-xs"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="accent"
          onClick={onReset}
          disabled={pending || pw.length < 8}
          className="w-full capitalize h-9 text-sm gap-1.5"
        >
          <KeyRound className="h-3.5 w-3.5" /> {t("superAdmin.reset")}
        </Button>
      </div>
      {error ? <p className="text-xs text-danger mt-1">{error}</p> : null}

      <DeleteConfirmModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={onDelete}
        title={t("superAdmin.deleteElite") || "Delete Elite User"}
        description={t("superAdmin.deleteEliteConfirm", { email: user.email })}
        isPending={pending}
        cancelText={t("common.cancel")}
        confirmText={t("common.confirm")}
        loadingText={t("common.loading")}
      />
    </div>
  );
}
