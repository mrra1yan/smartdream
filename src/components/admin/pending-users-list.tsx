"use client";

import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Trash2, Users, Mail, Phone, Calendar, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import { approveUser, rejectUser } from "@/app/actions/admin";

import { toast } from "sonner";
import { createPortal } from "react-dom";
import type { PendingUserProfile } from "@/lib/admin";

export function PendingUsersList({ initialPending }: { initialPending: PendingUserProfile[] }) {
  const { t } = useI18n();
  const [selectedUser, setSelectedUser] = useState<PendingUserProfile | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleApprove = (userId: string) => {
    startTransition(async () => {
      try {
        const res = await approveUser(userId);
        if (res.ok) {
          toast.success("User approved successfully");
          setSelectedUser(null);
        } else {
          toast.error(res.error || "Failed to approve user");
        }
      } catch {
        toast.error("Something went wrong");
      }
    });
  };

  const handleReject = (userId: string) => {
    startTransition(async () => {
      try {
        const res = await rejectUser(userId);
        if (res.ok) {
          toast.success("User rejected successfully");
          setSelectedUser(null);
        } else {
          toast.error(res.error || "Failed to reject user");
        }
      } catch {
        toast.error("Something went wrong");
      }
    });
  };

  if (initialPending.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        {t("admin.noPending")}
      </p>
    );
  }

  return (
    <>
      {/* 4-column responsive grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {initialPending.map((u) => {
          const initials = `${u.firstName?.[0] || ""}${u.lastName?.[0] || ""}`.toUpperCase();
          return (
            <motion.div
              key={u.id}
              onClick={() => setSelectedUser(u)}
              layoutId={`user-card-${u.id}`}
              className="group relative flex flex-col items-center justify-center text-center gap-3 rounded-2xl border border-border/40 bg-surface/90 p-5 hover:border-accent/30 transition-all hover:bg-surface/50 cursor-pointer shadow-sm hover:shadow-md min-h-[140px]"
            >
              <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-accent/5 blur-2xl group-hover:bg-accent/10 transition-colors pointer-events-none" />
              
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/20 to-purple-600/20 text-accent border border-accent/20 font-black text-base shadow-sm">
                {initials || <Users className="h-5 w-5" />}
              </div>

              <div className="min-w-0 w-full px-2">
                <p className="truncate text-sm font-bold text-foreground group-hover:text-accent transition-colors">
                  {u.firstName} {u.lastName}
                </p>
                <p className="truncate text-xs text-muted-foreground mt-1">
                  ID: {u.publicId}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Details Popup Modal */}
      {typeof window !== "undefined" && createPortal(
        <AnimatePresence>
          {selectedUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSelectedUser(null)}
                className="absolute inset-0 bg-black/60"
              />

              {/* Modal Box */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-2xl z-10 flex flex-col gap-5 [padding-bottom:calc(1.5rem+env(safe-area-inset-bottom))]"
              >
                {/* Decorative backgrounds */}
                <div className="absolute -right-16 -top-16 h-36 w-36 rounded-full bg-accent/10 blur-[40px] pointer-events-none" />
                <div className="absolute -left-16 -bottom-16 h-36 w-36 rounded-full bg-purple-600/5 blur-[40px] pointer-events-none" />

                {/* Header */}
                <div className="flex items-start justify-between relative z-10">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/20 to-purple-600/20 text-accent border border-accent/20 font-black text-base shadow-sm">
                      {`${selectedUser.firstName?.[0] || ""}${selectedUser.lastName?.[0] || ""}`.toUpperCase()}
                    </div>
                    <div>
                      <h2 className="text-base font-extrabold text-foreground">
                        {selectedUser.firstName} {selectedUser.lastName}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        ID: {selectedUser.publicId}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedUser(null)}
                    className="rounded-xl border border-border/40 p-2 text-muted-foreground hover:text-foreground hover:bg-surface/50 transition-all cursor-pointer shadow-sm"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* User Details */}
                <div className="relative z-10 flex flex-col gap-3.5 bg-background/30 border border-border/40 rounded-2xl p-4">
                  <div className="flex items-center gap-3 text-xs">
                    <Mail className="h-4 w-4 text-accent/70 shrink-0" />
                    <div className="min-w-0">
                      <span className="block font-medium text-muted-foreground text-[10px] uppercase">{t("auth.email")}</span>
                      <span className="text-foreground font-semibold break-all">{selectedUser.email}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <Phone className="h-4 w-4 text-purple-500 shrink-0" />
                    <div className="min-w-0">
                      <span className="block font-medium text-muted-foreground text-[10px] uppercase">{t("auth.phone")}</span>
                      <span className="text-foreground font-semibold">{selectedUser.phone || "—"}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <Calendar className="h-4 w-4 text-indigo-500 shrink-0" />
                    <div className="min-w-0">
                      <span className="block font-medium text-muted-foreground text-[10px] uppercase">{t("superAdmin.joined")}</span>
                      <span className="text-foreground font-semibold">
                        {new Date(selectedUser.createdAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                      </span>
                    </div>
                  </div>

                  {selectedUser.referrerName ? (
                    <div className="flex items-center gap-3 text-xs">
                      <User className="h-4 w-4 text-emerald-500 shrink-0" />
                      <div className="min-w-0">
                        <span className="block font-medium text-muted-foreground text-[10px] uppercase">{t("admin.referredBy")}</span>
                        <span className="text-foreground font-semibold">
                          {selectedUser.referrerName} (ID: {selectedUser.referrerPublicId})
                        </span>
                      </div>
                    </div>
                  ) : selectedUser.referredBy ? (
                    <div className="flex items-center gap-3 text-xs">
                      <User className="h-4 w-4 text-emerald-500 shrink-0" />
                      <div className="min-w-0">
                        <span className="block font-medium text-muted-foreground text-[10px] uppercase">{t("admin.referredBy")} ID</span>
                        <span className="text-foreground font-semibold">{selectedUser.referredBy}</span>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Action Buttons */}
                <div className="relative z-10 flex items-center gap-3 mt-2 shrink-0">
                  <Button
                    onClick={() => handleApprove(selectedUser.id)}
                    disabled={isPending}
                    variant="accent"
                    className="flex-1 rounded-xl h-11 font-bold text-xs gap-1.5 shadow-md shadow-accent/10 cursor-pointer active:scale-95 transition-transform"
                  >
                    <Check className="h-4 w-4" />
                    {t("admin.approve")}
                  </Button>

                  <Button
                    onClick={() => handleReject(selectedUser.id)}
                    disabled={isPending}
                    variant="outline"
                    className="rounded-xl h-11 px-4 border-danger/25 text-danger bg-danger/5 hover:bg-danger hover:text-white hover:border-danger transition-all cursor-pointer active:scale-95"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
