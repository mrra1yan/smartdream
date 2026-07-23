"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Users, X, Activity, LinkIcon, UserPlus, Clock, Settings, Check, Trash2, Rocket, Phone, Calendar } from "lucide-react";
import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";

const WeeklyLikeChart = dynamic(
  () => import("@/components/shared/weekly-like-chart").then(mod => mod.WeeklyLikeChart),
  { ssr: false, loading: () => <div className="w-full min-h-[400px] flex items-center justify-center rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-xl"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div> }
);
import { useI18n } from "@/components/i18n-provider";
import { UserControls } from "@/components/admin/user-controls";
import { Button } from "@/components/ui/button";
import type { AdminProfile } from "@/lib/types";

import { approveUser, rejectUser, getSelectedUserLinks, getSelectedUserStats, getSelectedUserReferrals } from "@/app/actions/admin";
import type { UserLink, UserStats, ReferralStats } from "@/lib/admin";

type StatusTab = "active" | "pending" | "admin";

export function UsersManagerClient({ initialUsers }: { initialUsers: AdminProfile[] }) {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [activeTab, setActiveTab] = React.useState<StatusTab>("active");
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
  
  const [profiles, setProfiles] = React.useState(initialUsers);
  const [pendingAction, startActionTransition] = React.useTransition();

  React.useEffect(() => {
    setProfiles(initialUsers);
  }, [initialUsers]);

  const handleApprove = (userId: string) => {
    startActionTransition(async () => {
      const res = await approveUser(userId);
      if (res.ok) {
        setProfiles((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, status: "approved" as const } : u))
        );
      }
    });
  };

  const handleReject = (userId: string) => {
    if (confirm("Are you sure you want to reject and remove this user?")) {
      startActionTransition(async () => {
        const res = await rejectUser(userId);
        if (res.ok) {
          setProfiles((prev) => prev.filter((u) => u.id !== userId));
          setSelectedUserId(null);
        }
      });
    }
  };

  // Filter logic in real-time
  const filteredUsers = React.useMemo(() => {
    return profiles.filter((u) => {
      // Role filter (we only show users and admins, not super_admins)
      if (u.role === "super_admin" || u.isElite) return false;

      // Rejected users are completely removed from site
      if (u.status === "rejected") return false;

      // Status tab filter
      if (activeTab === "active") {
        if (u.status !== "approved" || u.role !== "user") return false;
      } else if (activeTab === "pending") {
        if (u.status !== "pending" || u.role !== "user") return false;
      } else if (activeTab === "admin") {
        if (u.role !== "admin") return false;
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const fullName = `${u.firstName} ${u.lastName}`.toLowerCase();
        return (
          u.publicId.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          fullName.includes(q) ||
          u.phone.includes(q)
        );
      }

      return true;
    });
  }, [profiles, activeTab, searchQuery]);

  // Selected user info
  const selectedUser = React.useMemo(() => {
    if (!selectedUserId) return null;
    return profiles.find((u) => u.id === selectedUserId) || null;
  }, [profiles, selectedUserId]);

  const [selectedUserLinks, setSelectedUserLinks] = React.useState<UserLink[]>([]);
  const [selectedUserStats, setSelectedUserStats] = React.useState<UserStats>({
    givenToday: 0,
    receivedToday: 0,
  });
  const [selectedUserReferral, setSelectedUserReferral] = React.useState<ReferralStats>({
    referredByProfile: null,
    approvedByProfile: null,
    totalReferred: 0,
  });
  const [loadingDetails, setLoadingDetails] = React.useState(false);

  React.useEffect(() => {
    if (!selectedUserId) {
      setSelectedUserLinks([]);
      setSelectedUserStats({ givenToday: 0, receivedToday: 0 });
      setSelectedUserReferral({ referredByProfile: null, approvedByProfile: null, totalReferred: 0 });
      return;
    }

    setLoadingDetails(true);
    const fetchData = async () => {
      try {
        const [links, stats, referrals] = await Promise.all([
          getSelectedUserLinks(selectedUserId),
          getSelectedUserStats(selectedUserId),
          getSelectedUserReferrals(selectedUserId),
        ]);
        setSelectedUserLinks(links);
        setSelectedUserStats(stats);
        setSelectedUserReferral(referrals);
      } catch (err) {
        console.error("Error loading user details:", err);
      } finally {
        setLoadingDetails(false);
      }
    };

    fetchData();
  }, [selectedUserId]);

  const approvedCount = React.useMemo(() => {
    return profiles.filter(
      (p) => !p.isElite && p.role === "user" && p.status === "approved"
    ).length;
  }, [profiles]);

  // Helper for status badge styling
  const getStatusBadgeStyles = (status: string) => {
    switch (status) {
      case "approved":
        return "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20";
      case "rejected":
        return "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20";
      default:
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "approved":
        return t("admin.statusApproved") || "Approved";
      case "rejected":
        return t("admin.statusRejected") || "Rejected";
      default:
        return t("admin.statusPending") || "Pending";
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full py-2">
      {/* Header & Total Count */}
      <div className="flex items-center justify-between border-b border-border/20 pb-4">
        <h1 className="text-2xl font-black text-foreground flex items-center gap-2">
          <Users className="h-6 w-6 text-accent" />
          {t("admin.users") || "Users"}
        </h1>
        <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent ring-1 ring-inset ring-accent/20">
          {approvedCount} {t("admin.users") || "Users"}
        </span>
      </div>

      {/* Filter Options & Search Container */}
      <div className="flex flex-col gap-4 w-full">
        {/* Search Input */}
        <div className="relative w-full">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("admin.searchPlaceholder") || "Search by ID, email, name or phone..."}
            className="w-full pl-11 pr-4 h-12 rounded-2xl border border-border/50 bg-surface/90 shadow-inner focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:border-accent/50 placeholder:text-muted-foreground/50 transition-all outline-none text-sm text-foreground"
          />
        </div>

        {/* Tab Filter Bar */}
        <div className="flex bg-surface/90 p-1.5 rounded-2xl border border-border/50 self-start overflow-x-auto max-w-full">
          {(["active", "pending", "admin"] as StatusTab[]).map((tab) => {
            const isActive = activeTab === tab;
            const count = profiles.filter((p) => {
              if (p.isElite) return false;
              if (tab === "active") return p.status === "approved" && p.role === "user";
              if (tab === "pending") return p.status === "pending" && p.role === "user";
              if (tab === "admin") return p.role === "admin";
              return false;
            }).length;

            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`relative flex items-center px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer whitespace-nowrap ${
                  isActive ? "bg-accent text-white shadow-md shadow-accent/20" : "text-muted-foreground hover:text-foreground hover:bg-surface/50"
                }`}
              >
                <span className="relative z-10 capitalize">
                  {tab === "active" ? (t("premium.active") || "Active") : 
                   tab === "pending" ? (t("admin.statusPending") || "Pending") : 
                   (t("profile.role_admin") || "Admin")}
                </span>
                <span className={`ml-1.5 relative z-10 text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? "bg-white/20 text-white" : "bg-muted-foreground/10 text-muted-foreground"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Users Grid */}
      {filteredUsers.length === 0 ? (
        <div className="relative overflow-hidden rounded-3xl border border-border/40 bg-surface/80 py-16 text-center shadow-inner">
          <Users className="mx-auto h-10 w-10 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground font-semibold">
            {searchQuery ? t("admin.noUsersMatch") || "No users match your search." : t("admin.noUsersRegistered") || "No users found in this filter."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredUsers.map((u) => {
            const initials = `${u.firstName?.[0] || ""}${u.lastName?.[0] || ""}`.toUpperCase();
            const hasFreeAutoLike = u.freeAutoLikeUntil ? new Date(u.freeAutoLikeUntil).getTime() > Date.now() : false;
            const hasActiveFeatures = u.isBoosted || u.autoLikeEnabled || hasFreeAutoLike;

            return (
              <div
                key={u.id}
                onClick={() => setSelectedUserId(u.id)}
                className="group relative flex flex-col justify-between gap-4 rounded-3xl border border-border/40 bg-surface/90 p-5 hover:border-accent/40 transition-all hover:bg-surface/50 hover:shadow-xl cursor-pointer"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/20 to-purple-600/20 text-accent border border-accent/20 font-black text-sm shadow-inner group-hover:scale-105 transition-transform">
                    {initials || <Users className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-foreground group-hover:text-accent transition-colors">
                      {u.firstName} {u.lastName}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground/80 mt-0.5">
                      {u.email}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground/60 mt-1 font-semibold">
                      ID: {u.publicId}
                    </p>
                    {u.phone && (
                      <p className="truncate text-[10px] text-muted-foreground/70 mt-0.5 flex items-center gap-1">
                        <Phone className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">{u.phone}</span>
                      </p>
                    )}
                    <p className="truncate text-[10px] text-muted-foreground/70 mt-0.5 flex items-center gap-1">
                      <Calendar className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{new Date(u.createdAt).toLocaleDateString()}</span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between border-t border-border/10 pt-3 gap-2 mt-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase ${getStatusBadgeStyles(u.status)}`}>
                      {getStatusLabel(u.status)}
                    </span>
                    {u.role === "admin" && (
                      <span className="rounded-full bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-[9px] font-black uppercase text-blue-600 dark:text-blue-400">
                        {t("nav.admin") || "Admin"}
                      </span>
                    )}
                  </div>

                  {hasActiveFeatures && (
                    <div className="flex items-center gap-1">
                      {u.isBoosted && (
                        <span className="flex items-center justify-center h-5 w-5 rounded-full bg-accent/10 border border-accent/20 text-accent shadow-sm" title={t("admin.boosted") || "Boosted"}>
                          <Rocket className="h-3 w-3 fill-accent/10" />
                        </span>
                      )}
                      {(u.autoLikeEnabled || hasFreeAutoLike) && (
                        <span className="flex items-center justify-center h-5 w-5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-500 shadow-sm" title={t("admin.autoLike") || "Auto Like"}>
                          <Activity className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Details Popup Modal */}
      <AnimatePresence>
        {selectedUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
            {/* Modal Backdrop overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedUserId(null)}
              className="fixed inset-0 bg-black/60"
            />

            {/* Modal Box */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", duration: 0.4 }}
              className="relative w-full max-w-4xl rounded-3xl border border-border/60 bg-surface/90 p-6 shadow-2xl z-10 overflow-hidden max-h-[85vh] flex flex-col gap-6"
            >
              {/* Blur Glowing Overlays inside Modal */}
              <div className="absolute -right-20 -top-20 h-44 w-44 rounded-full bg-accent/10 blur-[50px] pointer-events-none" />
              <div className="absolute -left-20 -bottom-20 h-44 w-44 rounded-full bg-purple-500/5 blur-[50px] pointer-events-none" />

              {/* Modal Header */}
              <div className="flex items-start justify-between border-b border-border/10 pb-4 relative z-10 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-accent/20 to-purple-600/20 text-accent border border-accent/20 font-black text-xl shadow-md">
                    {`${selectedUser.firstName?.[0] || ""}${selectedUser.lastName?.[0] || ""}`.toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-foreground">
                      {selectedUser.firstName} {selectedUser.lastName}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5 font-medium">
                      {selectedUser.email} {selectedUser.phone ? `· ${selectedUser.phone}` : ""}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedUserId(null)}
                    className="rounded-xl border border-border/40 p-2 text-muted-foreground hover:text-foreground hover:bg-surface/50 transition-all cursor-pointer shadow-sm"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Scrollable details view */}
              <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-6 relative z-10 no-scrollbar">
                {/* Status Badges & Quick info */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="rounded-full bg-surface/80 border border-border/50 px-3 py-1 text-xs font-semibold text-muted-foreground">
                    ID: {selectedUser.publicId}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${getStatusBadgeStyles(selectedUser.status)}`}>
                    {getStatusLabel(selectedUser.status)}
                  </span>
                  {selectedUser.isBoosted && (
                    <span className="rounded-full bg-accent/15 border border-accent/20 px-3 py-1 text-xs font-semibold text-accent">
                      {t("admin.boosted") || "Boosted"}
                    </span>
                  )}
                  {(selectedUser.autoLikeEnabled || (selectedUser.freeAutoLikeUntil && new Date(selectedUser.freeAutoLikeUntil).getTime() > Date.now())) && (
                    <span className="rounded-full bg-purple-500/15 border border-purple-500/20 px-3 py-1 text-xs font-semibold text-purple-500">
                      {t("admin.autoLike") || "Auto Like"}
                    </span>
                  )}
                  {selectedUserReferral.referredByProfile && (
                    <span className="rounded-full bg-blue-500/10 border border-blue-500/20 px-3 py-1 text-xs font-medium text-blue-600 dark:text-blue-400">
                      {t("admin.referredBy") || "Referred by"}: <strong className="font-bold">{selectedUserReferral.referredByProfile.firstName} {selectedUserReferral.referredByProfile.lastName}</strong>
                    </span>
                  )}
                </div>

                {loadingDetails ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground w-full">
                    <div className="animate-spin rounded-full h-8 w-8 border-2 border-accent border-t-transparent" />
                    <span className="text-xs font-semibold">{t("admin.loadingDetails") || "Loading details..."}</span>
                  </div>
                ) : (
                  <>
                    {/* Referral network information for approved/normal users */}
                    {selectedUser.status === "approved" && selectedUser.role === "user" && (
                      <div className="rounded-2xl border border-border/40 bg-surface/90 p-5 shadow-sm flex flex-col gap-4">
                        <h3 className="text-sm font-black text-foreground flex items-center gap-2">
                          <UserPlus className="h-4 w-4 text-accent" />
                          {t("stats.referralProgram") || "Referral Program"}
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          {/* Referred By */}
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-black uppercase text-muted-foreground">{t("admin.referredBy") || "Referred By"}</span>
                            {selectedUserReferral.referredByProfile ? (
                              <span className="text-sm font-semibold text-foreground">
                                {selectedUserReferral.referredByProfile.firstName} {selectedUserReferral.referredByProfile.lastName} ({selectedUserReferral.referredByProfile.publicId})
                              </span>
                            ) : (
                              <span className="text-sm font-semibold text-muted-foreground/60">{t("admin.directRegistration") || "None (Direct Registration)"}</span>
                            )}
                          </div>

                          {/* Approved By */}
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-black uppercase text-muted-foreground">{t("superAdmin.approvedBy")}</span>
                            {selectedUserReferral.approvedByProfile ? (
                              <span className="text-sm font-semibold text-foreground">
                                {selectedUserReferral.approvedByProfile.firstName} {selectedUserReferral.approvedByProfile.lastName} ({selectedUserReferral.approvedByProfile.publicId})
                              </span>
                            ) : (
                              <span className="text-sm font-semibold text-muted-foreground/60">{t("admin.autoApproved") || "System / Auto-Approved"}</span>
                            )}
                          </div>

                          {/* Users Referred By This User */}
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-black uppercase text-muted-foreground">{t("admin.totalReferred") || "Users Referred"}</span>
                            <span className="text-sm font-bold text-foreground">
                              {selectedUserReferral.totalReferred} {t("admin.users")}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Approve option for pending users */}
                    {selectedUser.status === "pending" && (
                      <div className="w-full flex flex-col gap-4 p-5 rounded-2xl border border-amber-500/20 bg-amber-500/5">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-amber-500 animate-pulse" />
                          <span className="text-sm font-bold text-foreground">{t("admin.pendingApproval")}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t("admin.pendingDesc")}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 mt-2">
                          <Button
                            onClick={() => handleApprove(selectedUser.id)}
                            disabled={pendingAction}
                            variant="accent"
                            className="rounded-xl px-4 py-2 text-xs font-bold gap-1"
                          >
                            <Check className="h-3.5 w-3.5" /> {t("admin.approve") || "Approve"}
                          </Button>
                          <Button
                            onClick={() => handleReject(selectedUser.id)}
                            disabled={pendingAction}
                            variant="outline"
                            className="rounded-xl px-4 py-2 text-xs font-bold gap-1 border-danger/20 text-danger hover:bg-danger/10 hover:text-danger hover:border-danger/30"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> {t("admin.rejectDelete") || "Reject / Delete"}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Grid: Stats Cards - only for approved users (not admins) */}
                    {selectedUser.status === "approved" && selectedUser.role === "user" && (
                      <div className="grid grid-cols-3 gap-4">
                        <div className="p-4 rounded-2xl border border-border/40 bg-surface/90 flex flex-col gap-1 shadow-sm">
                          <span className="text-[10px] font-black uppercase text-muted-foreground">{t("admin.givenToday") || "Given Today"}</span>
                          <span className="text-xl font-black text-accent">{selectedUserStats.givenToday}</span>
                        </div>
                        <div className="p-4 rounded-2xl border border-border/40 bg-surface/90 flex flex-col gap-1 shadow-sm">
                          <span className="text-[10px] font-black uppercase text-muted-foreground">{t("admin.receivedToday") || "Received Today"}</span>
                          <span className="text-xl font-black text-purple-500">{selectedUserStats.receivedToday}</span>
                        </div>
                        <div className="p-4 rounded-2xl border border-border/40 bg-surface/90 flex flex-col gap-1 shadow-sm">
                          <span className="text-[10px] font-black uppercase text-muted-foreground">{t("admin.totalReferred") || "Referred"}</span>
                          <span className="text-xl font-black text-blue-500">{selectedUserReferral.totalReferred}</span>
                        </div>
                      </div>
                    )}

                    {/* Management & Actions */}
                    {selectedUser.status === "approved" && (
                      <div className="w-full flex flex-col gap-6 pt-2 border-t border-border/10 mt-2">
                        <h3 className="text-sm font-black text-foreground flex items-center gap-2">
                          <Settings className="h-4 w-4 text-accent" />
                          {t("admin.managementActions") || "Management & Actions"}
                        </h3>
                        <UserControls 
                          userId={selectedUser.id} 
                          role={selectedUser.role}
                          isBoosted={selectedUser.isBoosted} 
                          isAutoLikeEnabled={selectedUser.autoLikeEnabled} 
                        />
                      </div>
                    )}

                    {/* User Links and Weekly Chart - only for approved users */}
                    {selectedUser.status === "approved" && selectedUser.role === "user" && (
                      <>
                        {/* Weekly Like Chart */}
                        <div className="w-full mt-4">
                          <WeeklyLikeChart userId={selectedUser.id} />
                        </div>

                        {/* User Links Section */}
                        <div className="rounded-2xl border border-border/40 bg-surface/80 p-5 shadow-sm mt-4">
                          <h3 className="text-sm font-black text-foreground flex items-center gap-2 mb-4">
                            <LinkIcon className="h-4 w-4 text-accent" />
                            {t("nav.links") || "Links"} ({selectedUserLinks.length})
                          </h3>
                          {selectedUserLinks.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-4">{t("admin.noLinksUser") || "No links added yet."}</p>
                          ) : (
                            <div className="grid grid-cols-1 gap-2.5">
                              {selectedUserLinks.map((link) => (
                                <div key={link.id} className="flex items-center justify-between gap-4 rounded-xl border border-border/30 bg-surface/90 px-4 py-2.5 hover:border-accent/20 transition-all">
                                  <span className="truncate text-xs font-semibold text-foreground">{link.url}</span>
                                  <span className="shrink-0 text-[10px] font-bold text-accent bg-accent/10 border border-accent/20 rounded-full px-2.5 py-0.5">
                                    {link.likesCount} {t("common.likes") || "Likes"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
