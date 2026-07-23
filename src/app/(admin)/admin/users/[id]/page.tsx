import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getI18n } from "@/lib/i18n";
import { getUserForAdmin, getUserLinks, getUserStats, getReferralStats } from "@/lib/admin";
import { UserControls } from "@/components/admin/user-controls";
import { Zap, Activity, LinkIcon, Users } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { Loader2 } from "lucide-react";
import nextDynamic from "next/dynamic";

const WeeklyLikeChart = nextDynamic(
  () => import("@/components/shared/weekly-like-chart").then(mod => mod.WeeklyLikeChart),
  { loading: () => <div className="w-full min-h-[400px] flex items-center justify-center rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-xl"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div> }
);

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const user = await getUserForAdmin(id);
  return { title: user ? `${user.firstName} ${user.lastName} | Admin` : "Admin" };
}

export default async function AdminUserDetailPage({ params }: Props) {
  const { t } = await getI18n();
  const { id } = await params;
  const user = await getUserForAdmin(id);
  if (!user) notFound();

  const [links, stats, referralStats] = await Promise.all([
    getUserLinks(user.id),
    getUserStats(user.id),
    getReferralStats(user.id)
  ]);
  const initials = `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase();

  return (
    <div className="flex flex-col gap-8 w-full py-2">
      {/* User Info Header Card */}
      <div className="relative overflow-hidden rounded-3xl border border-accent/20 bg-gradient-to-br from-accent/15 via-purple-500/10 to-background p-6 shadow-xl flex flex-col items-center gap-6">
        <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-accent/15 blur-2xl" />
        <div className="absolute -left-8 -bottom-8 h-28 w-28 rounded-full bg-purple-600/5 blur-2xl" />
        
        {/* Back navigation */}
        <div className="absolute top-4 left-4 z-20">
          <Link href="/admin/users" className="flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
            &larr; {t("admin.backToUsers")}
          </Link>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 relative z-10 w-full mt-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/20 to-purple-600/20 text-accent border border-accent/30 font-black text-2xl shadow-md">
            {initials || <Users className="h-8 w-8" />}
          </div>
          <div className="text-center sm:text-left flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-black text-foreground">
              {user.firstName} {user.lastName}
            </h1>
            <p className="text-sm text-muted-foreground mt-1 font-medium">
              {user.email} {user.phone ? `· ${user.phone}` : ""}
            </p>
            <div className="flex flex-wrap justify-center sm:justify-start items-center gap-2 mt-3">
              <span className="rounded-full bg-surface/80 border border-border/50 px-2.5 py-0.5 text-xs text-muted-foreground">
                {t("admin.publicId")}: {user.publicId}
              </span>
              <StatusBadge status={user.status} t={t} />
              {user.isBoosted ? <Tag variant="accent">{t("admin.boosted")}</Tag> : null}
              {user.autoLikeEnabled ? <Tag variant="purple">{t("admin.autoLike")}</Tag> : null}
              {referralStats.referredByProfile && (
                <span className="rounded-full bg-blue-500/10 border border-blue-500/20 px-2.5 py-0.5 text-xs text-blue-600 dark:text-blue-400">
                  {t("admin.referredBy") || "Referred by"}: <Link href={`/admin/users/${referralStats.referredByProfile.id}`} className="font-bold hover:underline">{referralStats.referredByProfile.firstName} {referralStats.referredByProfile.lastName}</Link>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats Section */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <StatCard label={t("admin.givenToday")} value={stats.givenToday} icon={<Zap className="h-5 w-5 text-accent" />} valueClassName="font-mono" />
        <StatCard label={t("admin.receivedToday")} value={stats.receivedToday} icon={<Activity className="h-5 w-5 text-purple-500" />} valueClassName="font-mono" />
      </section>

      {/* Weekly Like Chart */}
      <section className="w-full">
        <WeeklyLikeChart userId={user.id} />
      </section>

      {/* Controls */}
      <UserControls
        userId={user.id}
        isBoosted={user.isBoosted}
        isAutoLikeEnabled={user.autoLikeEnabled}
        currentBoostModel={user.boostModel}
        currentAutoLikeModel={user.autoLikeModel}
        autoLikePaused={user.autoLikePaused}
      />

      {/* Links Container */}
      <section className="relative overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-xl">
        <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-accent/5 blur-3xl" />
        
        <div className="mb-6 flex items-center justify-between border-b border-border/20 pb-4">
          <h2 className="text-lg font-black text-foreground flex items-center gap-2">
            <LinkIcon className="h-5 w-5 text-accent" />
            {t("nav.links")} ({links.length})
          </h2>
        </div>

        {links.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("admin.noLinksUser")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {links.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-4 rounded-2xl border border-border/40 bg-surface/90 p-4 hover:border-accent/20 transition-all">
                <span className="truncate text-sm font-semibold text-foreground">{l.url}</span>
                <span className="ml-3 shrink-0 text-xs font-bold text-accent bg-accent/10 border border-accent/20 rounded-full px-2.5 py-0.5">
                  {l.likesCount} {t("common.likes")}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}



function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const color =
    status === "approved"
      ? "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20"
      : status === "rejected"
        ? "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"
        : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20";
        
  const label = 
    status === "approved"
      ? t("admin.statusApproved")
      : status === "rejected"
        ? t("admin.statusRejected")
        : t("admin.statusPending");

  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${color}`}>
      {label}
    </span>
  );
}

function Tag({ children, variant = "accent" }: { children: React.ReactNode; variant?: "accent" | "purple" }) {
  const colorClass = variant === "purple"
    ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
    : "bg-accent/10 text-accent border border-accent/20";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${colorClass}`}>
      {children}
    </span>
  );
}
