"use client";

import { Zap, Activity } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { useStatsRealtime } from "@/lib/use-stats-realtime";
import type { UserStats } from "@/lib/admin";

export function ProfileStatsClient({
  initialStats,
  userId,
}: {
  initialStats: UserStats;
  userId: string;
}) {
  const { t, locale } = useI18n();
  const stats = useStatsRealtime(initialStats, userId);

  const toBengaliNumber = (num: number | string): string => {
    const str = String(num);
    if (locale !== "bn") return str;
    const bnDigits = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
    return str.replace(/[0-9]/g, (digit) => bnDigits[parseInt(digit, 10)]);
  };

  return (
    <div className="grid grid-cols-2 gap-4">
      <StatCard
        title={`${t("home.statsGiven")} · ${t("home.today")}`}
        value={toBengaliNumber(stats.givenToday)}
        icon={<Zap className="h-5 w-5 text-accent" />}
      />
      <StatCard
        title={`${t("home.statsReceived")} · ${t("home.today")}`}
        value={toBengaliNumber(stats.receivedToday)}
        icon={<Activity className="h-5 w-5 text-purple-500" />}
      />
    </div>
  );
}

function StatCard({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="relative group/stat overflow-hidden rounded-2xl border border-border/40 bg-background/20 p-5 hover:border-accent/30 hover:bg-background/30 transition-all min-h-[110px] flex flex-col justify-between">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase text-muted-foreground/85 leading-snug">
          {title}
        </span>
        <div className="hidden sm:flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent/5 border border-accent/10 group-hover/stat:bg-accent/10 transition-colors">
          {icon}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 mt-4">
        <span className="block text-2xl sm:text-3xl font-black text-foreground">
          {value}
        </span>
        <div className="flex sm:hidden h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent/5 border border-accent/10 group-hover/stat:bg-accent/10 transition-colors">
          {icon}
        </div>
      </div>
    </div>
  );
}
