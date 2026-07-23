import { getI18n } from "@/lib/i18n";
import { getAdminCounts, getPendingUsers, getTopLikers, getActiveUsersLinkCount } from "@/lib/admin";
import { Users, Clock, Shield, Crown, Link2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { WelcomeBanner } from "@/components/welcome-banner";
import { PendingUsersList } from "@/components/admin/pending-users-list";
import { cn } from "@/lib/utils";

export default async function AdminPage() {
  const [{ t }, counts, pending, topMembers, activeUserLinks] = await Promise.all([
    getI18n(),
    getAdminCounts(),
    getPendingUsers(),
    getTopLikers(5),
    getActiveUsersLinkCount()
  ]);

  return (
    <div className="flex flex-col gap-8 w-full py-2">
      {/* Welcome Banner */}
      <WelcomeBanner>
        <PageHeader
          badge={t("admin.staffPortal")}
          title={t("nav.admin")}
          description={t("admin.dashboardSubtitle")}
          gradient={false}
          className="relative z-10"
        />
      </WelcomeBanner>

      {/* Overview stats */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-6">
        <StatCard
          label={t("admin.totalUsers")}
          value={counts.total}
          icon={<Users className="h-5 w-5 text-accent" />}
        />
        <StatCard
          label={t("admin.pendingApproval")}
          value={counts.pending}
          icon={<Clock className="h-5 w-5 text-amber-500" />}
        />
        <StatCard
          label={t("admin.totalAdmins")}
          value={counts.admins}
          icon={<Shield className="h-5 w-5 text-green-500" />}
        />
        <StatCard
          label={t("admin.activeUserLinks")}
          value={activeUserLinks}
          icon={<Link2 className="h-5 w-5 text-sky-500" />}
        />
      </section>

      {/* Main Grid: Pending users list & Top Members */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Pending users list */}
        <section className="lg:col-span-2 relative overflow-hidden rounded-3xl border border-border dark:border-border/40 bg-surface/90 p-6 shadow-xl">
          <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-accent/5 blur-3xl pointer-events-none" />

          <div className="mb-6 flex items-center justify-between border-b border-border/20 pb-4">
            <h2 className="text-lg font-black text-foreground flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
              {t("admin.pendingApproval")} {pending.length ? `(${pending.length})` : ""}
            </h2>
          </div>

          <PendingUsersList initialPending={pending} />
        </section>

        {/* Top Members */}
        <section className="relative overflow-hidden rounded-3xl border border-border dark:border-border/40 bg-surface/90 p-6 shadow-xl flex flex-col">
          <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-accent/5 blur-3xl pointer-events-none" />

          <div className="mb-6 flex items-center justify-between border-b border-border/20 pb-4">
            <h2 className="text-lg font-black text-foreground flex items-center gap-2">
              <Crown className="h-5 w-5 text-accent animate-pulse" />
              {t("admin.topMembers")}
            </h2>
          </div>

          <div className="flex flex-col gap-3 flex-1 justify-start">
            {topMembers.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground/80">No members found.</p>
            ) : (
              topMembers.map((member, idx) => {
                const rankColors = [
                  "bg-amber-500/15 text-amber-500 border-amber-500/30",
                  "bg-slate-400/15 text-slate-400 border-slate-400/30",
                  "bg-amber-700/15 text-amber-700 border-amber-700/30",
                  "bg-zinc-500/15 text-zinc-500 border-zinc-500/30",
                  "bg-zinc-500/15 text-zinc-500 border-zinc-500/30",
                ];
                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-border dark:border-border/40 bg-surface/50 hover:bg-surface transition-all shadow-sm group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Rank Badge */}
                      <span className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border text-xs font-black",
                        rankColors[idx] || "bg-zinc-500/15 text-zinc-500 border-zinc-500/30"
                      )}>
                        {idx + 1}
                      </span>
                      
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold text-foreground truncate group-hover:text-accent transition-colors">
                          {member.firstName} {member.lastName}
                        </span>
                        <span className="text-[10px] text-muted-foreground/80 truncate">
                          ID: {member.publicId}
                        </span>
                      </div>
                    </div>
                    
                    {/* Count badge */}
                    <div className="flex flex-col items-end shrink-0">
                      <span className="text-xs font-black text-accent bg-accent/10 border border-accent/25 rounded-lg px-2 py-0.5 shadow-sm">
                        {member.likesCount}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

