"use client";

import { useEffect, useState } from "react";
import { getMyStatsAction } from "@/app/actions/stats";
import type { UserStats } from "@/lib/admin";

/**
 * Shared hook for live stats (givenToday / receivedToday) via SSE
 * (/api/realtime) + periodic safety-net polling.
 *
 * Server actions publish `{"t":"like"}` to `chan:stats:{userId}` on every
 * committed like; this hook bumps receivedToday on the event. The 180s
 * polling + focus/visibility handlers stay as the authoritative fallback
 * (same as the old Supabase Realtime hook).
 */
export function useStatsRealtime(initialStats: UserStats, userId: string) {
  const [stats, setStats] = useState<UserStats>(initialStats);

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;

    es = new EventSource("/api/realtime");
    es.onmessage = (event) => {
      if (cancelled) return;
      try {
        const payload = JSON.parse(event.data) as { t?: string };
        if (payload.t === "like") {
          setStats((s) => ({ ...s, receivedToday: s.receivedToday + 1 }));
        }
      } catch {
        // ignore malformed frames
      }
    };

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

    // Safety-net poll: 180s fallback for silently-dropped SSE connections.
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
      if (es) es.close();
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleFocus);
        document.removeEventListener("visibilitychange", handleFocus);
        window.removeEventListener("stats_updated", handleStatsUpdated);
        window.removeEventListener("stats_sync", handleStatsSync);
      }
    };
  }, [userId]);

  return stats;
}
