"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getMyStatsAction } from "@/app/actions/stats";
import { getRealtimeAccessToken } from "@/app/actions/realtime";
import type { UserStats } from "@/lib/admin";

/**
 * Shared hook for live stats (givenToday / receivedToday) via Supabase
 * Realtime + periodic safety-net polling.
 *
 * Previously duplicated ~140 lines each in home-stats-client.tsx and
 * profile-stats-client.tsx. Consolidating saves bundle size, eliminates
 * the double-subscription when both components are mounted, and means
 * only one polling interval + one realtime channel per tab.
 */
export function useStatsRealtime(initialStats: UserStats, userId: string) {
  const [stats, setStats] = useState<UserStats>(initialStats);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const statsRef = useRef(stats);
  statsRef.current = stats;

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const token = await getRealtimeAccessToken();
      if (cancelled || !token) return;
      supabase.realtime.setAuth(token);

      channel = supabase
        .channel("stats_updates")
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
            setStats((s) => ({ ...s, receivedToday: s.receivedToday + 1 }));
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            void getMyStatsAction().then((s) => {
              if (!cancelled && s) setStats((prev) => ({
                ...s,
                givenToday: s.givenToday,
                receivedToday: Math.max(prev.receivedToday, s.receivedToday),
              }));
            });
          }
        });
    })();

    const setAuthoritative = (newStats: UserStats | null) => {
      if (cancelled || !newStats) return;
      setStats((prev) => ({
        ...newStats,
        givenToday: newStats.givenToday,
        receivedToday: Math.max(prev.receivedToday, newStats.receivedToday),
      }));
    };

    const updateStats = (newStats: UserStats | null) => {
      if (cancelled || !newStats) return;
      setStats((prev) => ({
        ...newStats,
        givenToday: Math.max(prev.givenToday, newStats.givenToday),
        receivedToday: Math.max(prev.receivedToday, newStats.receivedToday),
      }));
    };

    const handleFocus = () => {
      void getMyStatsAction().then(setAuthoritative);
    };

    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    let syncTimer: ReturnType<typeof setTimeout> | null = null;

    const handleStatsUpdated = () => {
      setStats((s) => ({ ...s, givenToday: s.givenToday + 1 }));
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(() => {
        void getMyStatsAction().then(updateStats);
      }, 2000);
    };

    const handleStatsSync = () => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        void getMyStatsAction().then(setAuthoritative);
      }, 1500);
    };

    // Safety-net poll: 180s fallback for silently-dropped WebSocket connections
    const pollInterval = setInterval(() => {
      if (cancelled || document.hidden) return;
      void getMyStatsAction().then(setAuthoritative);
    }, 180_000);

    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleFocus);
      document.addEventListener("visibilitychange", handleFocus);
      window.addEventListener("stats_updated", handleStatsUpdated);
      window.addEventListener("stats_sync", handleStatsSync);
    }

    return () => {
      cancelled = true;
      if (updateTimer) clearTimeout(updateTimer);
      if (syncTimer) clearTimeout(syncTimer);
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

  return stats;
}
