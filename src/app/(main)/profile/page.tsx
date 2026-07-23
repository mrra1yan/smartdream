import { getCurrentUser, toPublicProfile } from "@/lib/auth";
import { getMyStats } from "@/lib/stats";
import { getI18n } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { CopyableId } from "@/components/copyable-id";
import { ProfileReferralLink } from "@/components/profile-referral-link";
import { ProfileStatsClient } from "@/components/profile-stats-client";
import { User, Phone, Mail, Fingerprint, Pencil, KeyRound } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { PageHeader } from "@/components/page-header";
import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";

const WeeklyLikeChart = dynamic(
  () => import("@/components/shared/weekly-like-chart").then(mod => mod.WeeklyLikeChart),
  { loading: () => <div className="w-full min-h-[400px] flex items-center justify-center rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-xl"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div> }
);

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) return null;
  
  const profile = toPublicProfile(user);
  
  const [{ t }, stats, settings] = await Promise.all([
    getI18n(),
    getMyStats(),
    getSettings()
  ]);

  // Resolve localized role
  const roleLabel = profile.role === "super_admin" 
    ? t("profile.role_super_admin") 
    : profile.role === "admin" 
      ? t("profile.role_admin") 
      : t("profile.role_user");

  // Initials for avatar
  const initials = `${profile.firstName.slice(0, 1)}${profile.lastName.slice(0, 1)}`.toUpperCase();

  return (
    <div className="flex flex-col gap-6 w-full py-2">
      {/* Page Header */}
      <PageHeader
        badge={t("profile.badge")}
        title={t("nav.profile")}
        description={t("profile.description")}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Avatar & Action Buttons */}
        <div className="relative overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-xl flex flex-col items-center text-center gap-5 lg:col-span-1">
          {/* Ambient glows */}
          <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-accent/10 blur-2xl" />
          <div className="absolute -left-8 -bottom-8 h-28 w-28 rounded-full bg-purple-600/5 blur-2xl" />

          {/* Avatar with Ring */}
          <div className="p-1 rounded-3xl bg-gradient-to-br from-accent via-purple-500 to-indigo-600 shadow-xl shadow-accent/10 mt-2">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[20px] bg-background text-2xl font-black text-foreground">
              {initials}
            </div>
          </div>

          {/* Profile Name & ID */}
          <div className="space-y-3 w-full flex flex-col items-center">
            <div>
              <h2 className="text-xl font-black text-foreground">
                {profile.firstName} {profile.lastName}
              </h2>
              <span className="text-xs font-bold uppercase text-muted-foreground/60">
                {roleLabel}
              </span>
            </div>
            
            <div className="flex flex-col items-center gap-1 w-full bg-background/30 rounded-2xl p-3 border border-border/30">
              <span className="text-xs font-bold uppercase text-muted-foreground/80 flex items-center gap-1">
                <Fingerprint className="h-3 w-3 text-accent" />
                {t("common.appName")} ID
              </span>
              <CopyableId id={profile.publicId} />
              <ProfileReferralLink publicId={profile.publicId} rewardMinutes={settings.referralRewardReferrerMinutes} />
            </div>
          </div>


          {/* Action Buttons */}
          <div className="w-full flex flex-col gap-2 pt-4 border-t border-border/20 mt-2">
            <Link
              href="/profile/edit"
              className="flex items-center justify-center gap-2 w-full rounded-2xl border border-border bg-background/50 hover:bg-accent/5 hover:border-accent/30 px-4 py-3 text-xs font-bold text-foreground transition-all shadow-sm cursor-pointer"
            >
              <Pencil className="h-3.5 w-3.5 text-accent" />
              {t("profile.editProfile")}
            </Link>
            <Link
              href="/profile/password"
              className="flex items-center justify-center gap-2 w-full rounded-2xl border border-border bg-background/50 hover:bg-accent/5 hover:border-accent/30 px-4 py-3 text-xs font-bold text-foreground transition-all shadow-sm cursor-pointer"
            >
              <KeyRound className="h-3.5 w-3.5 text-purple-500" />
              {t("profile.changePassword")}
            </Link>
          </div>
        </div>

        {/* Right Columns (lg:col-span-2) */}
        <div className="lg:col-span-2 flex flex-col gap-6 w-full">
          {/* Personal Details Card */}
          <div className="flex flex-col gap-4 overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-xl">
            <h3 className="text-sm font-bold text-foreground/90 uppercase border-b border-border/20 pb-3 mb-1">
              {t("profile.personalDetails")}
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <DetailRow label={t("auth.firstName")} value={profile.firstName} icon={<User className="h-4 w-4 text-accent" />} />
              <DetailRow label={t("auth.lastName")} value={profile.lastName} icon={<User className="h-4 w-4 text-accent/70" />} />
              <DetailRow label={t("auth.phone")} value={profile.phone || "—"} icon={<Phone className="h-4 w-4 text-purple-500" />} />
              <DetailRow label={t("auth.email")} value={profile.email} icon={<Mail className="h-4 w-4 text-indigo-500" />} />
            </div>
          </div>

          {/* Activity Stats Card */}
          <div className="flex flex-col gap-4 overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-xl">
            <h3 className="text-sm font-bold text-foreground/90 uppercase border-b border-border/20 pb-3 mb-1">
              {t("profile.activityStats")}
            </h3>
            
            <ProfileStatsClient initialStats={stats} userId={user.id} />
          </div>

          {/* Weekly Like Chart */}
          <WeeklyLikeChart userId={user.id} />
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border/30 bg-background/30 p-3.5 hover:bg-accent/5 hover:border-accent/20 transition-all">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background shadow-sm border border-border/40">
        {icon}
      </div>
      <div className="min-w-0">
        <span className="block text-xs font-bold uppercase text-muted-foreground/75">{label}</span>
        <span className="block text-sm font-bold text-foreground truncate mt-0.5">{value}</span>
      </div>
    </div>
  );
}
