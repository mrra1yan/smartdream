"use client";

import { useEffect, useMemo, useState } from "react";
import { Zap, Activity } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { getMyStatsAction } from "@/app/actions/stats";
import { getRealtimeAccessToken } from "@/app/actions/realtime";
import type { UserStats } from "@/lib/admin";

// Same realtime subscription as home-stats-client.tsx -- kept as a separate
// client component (rather than sharing one) since this page's StatCard has
// its own visual style (title prop, different layout) from the shared
// @/components/stat-card used on the home page.
export function ProfileStatsClient({
  initialStats,
  userId,
}: {
  initialStats: UserStats;
  userId: string;
}) {
  const { t, locale } = useI18n();
  const [stats, setStats] = useState<UserStats>(initialStats);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      // The session cookie is httpOnly, so this client can't read it itself
      // to authenticate its own Realtime socket -- without this, the
      // subscription below silently connects as the anon key and RLS hides
      // every row. See getRealtimeAccessToken for the full explanation.
      const token = await getRealtimeAccessToken();
      if (cancelled || !token) return;
      supabase.realtime.setAuth(token);

      // Listen for likes RECEIVED by this user (other people liking us).
      // Own likes (givenToday) are tracked via the "stats_updated" window
      // event below -- see home-stats-client.tsx for the full rationale.
      channel = supabase
        .channel("profile_stats_updates")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "likes",
            filter: `receiver_id=eq.${userId}`,
          },
          (payload) => {
            if ((payload.new as { is_boosted_like?: boolean })?.is_boosted_like) return;
            setStats((s) => ({
              ...s,
              receivedToday: s.receivedToday + 1,
            }));
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            void getMyStatsAction().then(setAuthoritativeStats);
          }
        });
    })();

    const updateStats = (newStats: UserStats | null) => {
      if (!cancelled && newStats) {
        setStats((prev) => ({
          ...newStats,
          givenToday: Math.max(prev.givenToday, newStats.givenToday),
          receivedToday: Math.max(prev.receivedToday, newStats.receivedToday),
        }));
      }
    };

    const setAuthoritativeStats = (newStats: UserStats | null) => {
      if (!cancelled && newStats) {
        setStats((prev) => ({
          ...newStats,
          givenToday: Math.max(prev.givenToday, newStats.givenToday),
          receivedToday: Math.max(prev.receivedToday, newStats.receivedToday),
        }));
      }
    };

    const handleFocus = () => {
      void getMyStatsAction().then(setAuthoritativeStats);
    };

    let statsUpdateTimeout: NodeJS.Timeout | null = null;
    let statsSyncTimeout: NodeJS.Timeout | null = null;
    const handleStatsUpdated = () => {
      // Optimistically increment givenToday in state immediately for instant UI feedback
      setStats((s) => ({
        ...s,
        givenToday: s.givenToday + 1,
      }));

      // Background server sync with Math.max so a stale response
      // never overwrites a higher optimistic count while commit is in flight.
      if (statsUpdateTimeout) clearTimeout(statsUpdateTimeout);
      statsUpdateTimeout = setTimeout(() => {
        void getMyStatsAction().then(updateStats);
      }, 2000);
    };

    // stats_sync is dispatched when a commitLike attempt fails — fetch
    // authoritative counts without an optimistic increment to clear failed optimistic +1.
    const handleStatsSync = () => {
      if (statsSyncTimeout) clearTimeout(statsSyncTimeout);
      statsSyncTimeout = setTimeout(() => {
        void getMyStatsAction().then(setAuthoritativeStats);
      }, 1500);
    };

    // Periodic safety-net poll: same as home-stats-client.tsx
    const pollInterval = setInterval(() => {
      if (cancelled) return;
      void getMyStatsAction().then(setAuthoritativeStats);
    }, 30_000);

    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleFocus);
      document.addEventListener("visibilitychange", handleFocus);
      window.addEventListener("stats_updated", handleStatsUpdated);
      window.addEventListener("stats_sync", handleStatsSync);
    }

    return () => {
      cancelled = true;
      if (statsUpdateTimeout) clearTimeout(statsUpdateTimeout);
      if (statsSyncTimeout) clearTimeout(statsSyncTimeout);
      clearInterval(pollInterval);
      if (channel) supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleFocus);
        document.removeEventListener("visibilitychange", handleFocus);
        window.removeEventListener("stats_updated", handleStatsUpdated);
        window.removeEventListener("stats_sync", handleStatsSync);
      }
    };
  }, [userId, supabase]);

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
