"use client";

import { Activity, Zap } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { useI18n } from "@/components/i18n-provider";
import { useStatsRealtime } from "@/lib/use-stats-realtime";
import type { UserStats } from "@/lib/admin";

export function HomeStatsClient({
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
    <section className="grid grid-cols-2 gap-4 sm:gap-6">
      <StatCard
        label={`${t("home.statsGiven")} · ${t("home.today")}`}
        value={toBengaliNumber(stats.givenToday)}
        icon={<Zap className="h-5 w-5 text-accent" />}
      />
      <StatCard
        label={`${t("home.statsReceived")} · ${t("home.today")}`}
        value={toBengaliNumber(stats.receivedToday)}
        icon={<Activity className="h-5 w-5 text-purple-500" />}
      />
    </section>
  );
}
