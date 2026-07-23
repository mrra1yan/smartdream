"use client";

import { useState } from "react";
import { Search, X, Shield, Calendar, Award, Phone, Mail } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { AdminProfile } from "@/lib/types";
import { useI18n } from "@/components/i18n-provider";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { SuperUserActions } from "@/components/super-admin/super-user-actions";
import { getUserReferralStats } from "@/app/actions/super-admin";

interface UsersManagerProps {
  users: AdminProfile[];
  initialQ?: string;
}

export function UsersManager({ users, initialQ = "" }: UsersManagerProps) {
  const { t } = useI18n();
  const [q, setQ] = useState(initialQ);
  const [activeUser, setActiveUser] = useState<AdminProfile | null>(null);
  const [referralStats, setReferralStats] = useState<{
    referredByProfile: AdminProfile | null;
    approvedByProfile: AdminProfile | null;
    totalReferred: number;
  } | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Filter users client-side for smoother search experience
  const filteredUsers = users.filter((u) => matches(u, q.trim()));

  async function handleUserClick(user: AdminProfile) {
    setActiveUser(user);
    setLoadingStats(true);
    setReferralStats(null);
    try {
      const stats = await getUserReferralStats(user.id);
      setReferralStats(stats);
    } catch (err) {
      console.error("Failed to load referral stats", err);
    } finally {
      setLoadingStats(false);
    }
  }

  // Next.js page revalidation will update `users` prop. If the currently open user's
  // role/status is changed, update activeUser reference to reflect it.
  const currentUserInList = activeUser ? users.find((u) => u.id === activeUser.id) : null;
  const displayUser = currentUserInList || activeUser;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("superAdmin.allUsers")}</h1>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("superAdmin.searchPlaceholder")}
          className="pl-9"
        />
      </div>

      {filteredUsers.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">{t("superAdmin.noUsersFound")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredUsers.map((u) => (
            <div
              key={u.id}
              onClick={() => handleUserClick(u)}
              className="flex flex-col justify-between gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-accent/40 shadow-sm transition-colors cursor-pointer"
            >
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-foreground">
                  {u.firstName} {u.lastName}
                </p>
                <p className="truncate text-xs text-muted-foreground/80">
                  {u.email}
                </p>
                <p className="truncate text-[10px] text-muted-foreground/60 mt-0.5">
                  ID: {u.publicId} · {u.role === "admin" ? t("nav.admin") : u.role === "super_admin" ? t("nav.superAdmin") : t("nav.users")}
                </p>
              </div>
              <div className="mt-2 pt-2 border-t border-border/40 flex items-center justify-between gap-2 text-xs">
                <StatusBadge status={u.status} t={t} />
                {u.isElite ? <Tag>{t("nav.elite")}</Tag> : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Details Popup Modal */}
      <AnimatePresence>
        {displayUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveUser(null)}
              className="absolute inset-0 bg-black/60"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-2xl flex flex-col gap-5 max-h-[85vh] overflow-y-auto"
            >
              {/* Close button */}
              <button
                type="button"
                onClick={() => setActiveUser(null)}
                className="absolute top-4 right-4 rounded-full p-1.5 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-foreground transition-colors cursor-pointer z-10"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>

              {/* User Header */}
              <div className="flex flex-col gap-1.5 pr-6">
                <h2 className="text-xl font-bold text-foreground">
                  {displayUser.firstName} {displayUser.lastName}
                </h2>
                <div className="flex flex-col gap-1 text-sm text-muted-foreground/80">
                  <div className="flex items-center gap-1.5">
                    <Mail className="h-4 w-4 text-muted-foreground/60" />
                    <span>{displayUser.email}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Phone className="h-4 w-4 text-muted-foreground/60" />
                    <span>{displayUser.phone || t("superAdmin.noPhone")}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Shield className="h-4 w-4 text-muted-foreground/60" />
                    <span className="capitalize">
                      {t("superAdmin.role")}: {displayUser.role === "admin" ? t("nav.admin") : displayUser.role === "super_admin" ? t("nav.superAdmin") : t("nav.users")}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground/60 mt-1.5">
                  {t("admin.publicId")}: {displayUser.publicId}
                </p>
              </div>

              {/* Account Info Details */}
              <Card className="flex flex-col gap-3 p-4">
                <h3 className="text-sm font-bold uppercase text-muted-foreground/80 flex items-center gap-2">
                  <Award className="h-4 w-4 text-accent" />
                  {t("superAdmin.accountInfo")}
                </h3>
                
                <div className="grid grid-cols-2 gap-y-2.5 gap-x-4 text-sm">
                  <span className="text-muted-foreground">{t("admin.status")}</span>
                  <span className="font-medium">
                    <StatusBadge status={displayUser.status} t={t} />
                  </span>
                  
                  <span className="text-muted-foreground">{t("nav.elite")}</span>
                  <span className="font-semibold text-foreground">
                    {displayUser.isElite ? t("superAdmin.yes") : t("superAdmin.no")}
                  </span>
                  
                  <span className="text-muted-foreground">{t("superAdmin.joined")}</span>
                   <span className="text-foreground">
                     <span className="flex items-center gap-1.5">
                       <Calendar className="h-4 w-4 text-muted-foreground/60" />
                       {new Date(displayUser.createdAt).toLocaleDateString()}
                     </span>
                   </span>

                  {loadingStats ? (
                    <span className="col-span-2 text-center text-muted-foreground/60 py-2">
                      {t("common.loading") || "Loading stats..."}
                    </span>
                  ) : (
                    referralStats && (
                      <>
                        <span className="text-muted-foreground">{t("admin.referredBy") || "Referred by"}</span>
                        <span>
                          {referralStats.referredByProfile ? (
                            <span 
                              onClick={() => handleUserClick(referralStats.referredByProfile!)}
                              className="text-accent hover:underline cursor-pointer font-medium"
                            >
                              {referralStats.referredByProfile.firstName} {referralStats.referredByProfile.lastName}
                            </span>
                          ) : (
                            "-"
                          )}
                        </span>

                        <span className="text-muted-foreground">{t("superAdmin.approvedBy")}</span>
                        <span>
                          {referralStats.approvedByProfile ? (
                            <span 
                              onClick={() => handleUserClick(referralStats.approvedByProfile!)}
                              className="text-accent hover:underline cursor-pointer font-medium"
                            >
                              {referralStats.approvedByProfile.firstName} {referralStats.approvedByProfile.lastName}
                            </span>
                          ) : (
                            "-"
                          )}
                        </span>
                        
                        <span className="text-muted-foreground">{t("admin.totalReferred") || "Users Referred"}</span>
                        <span className="font-semibold text-foreground">{referralStats.totalReferred}</span>
                      </>
                    )
                  )}
                </div>
              </Card>

              {/* Actions Card */}
              <SuperUserActions user={displayUser} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function matches(u: AdminProfile, q: string): boolean {
  const needle = q.toLowerCase();
  return (
    u.publicId.toLowerCase() === needle ||
    u.email.toLowerCase().includes(needle) ||
    u.firstName.toLowerCase().includes(needle) ||
    u.lastName.toLowerCase().includes(needle) ||
    (u.phone ?? "").toLowerCase().includes(needle)
  );
}

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const color =
    status === "approved"
      ? "bg-green-500/15 text-green-600 dark:text-green-400"
      : status === "rejected"
        ? "bg-red-500/15 text-red-600 dark:text-red-400"
        : "bg-amber-500/15 text-amber-600 dark:text-amber-400";

  const label =
    status === "approved"
      ? t("admin.statusApproved")
      : status === "rejected"
        ? t("admin.statusRejected")
        : t("admin.statusPending");

  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}>{label}</span>;
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
      {children}
    </span>
  );
}
