"use client";

import { useEffect, useState, useMemo } from "react";
import { Activity, Zap } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useI18n } from "@/components/i18n-provider";
import { getMyStatsAction } from "@/app/actions/stats";
import { getRealtimeAccessToken } from "@/app/actions/realtime";
import type { UserStats } from "@/lib/admin";

export function HomeStatsClient({
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
      // event below -- keeping both a Realtime subscription AND the
      // stats_updated handler for givenToday caused double-counting because
      // every commitLike success fires stats_updated AND triggers a Realtime
      // INSERT event at nearly the same time.
      channel = supabase
        .channel("home_stats_updates")
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
          // Overwrite strictly to allow rolling back failed optimistic +1s
          givenToday: newStats.givenToday,
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

    // Periodic safety-net poll: Supabase Realtime WebSocket connections can
    // silently drop in native WebView contexts. This ensures stats stay
    // authoritative. 60s (not shorter) because the realtime subscription
    // above already delivers live updates in the normal case -- this is
    // just a fallback for when it silently drops.
    const pollInterval = setInterval(() => {
      if (cancelled) return;
      void getMyStatsAction().then(setAuthoritativeStats);
    }, 60_000);

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
