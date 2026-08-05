"use client";

import { create } from "zustand";
import { MAX_CONCURRENT_ADS, TOTAL_AD_SECONDS } from "@/lib/types";
import { commitLikeAction, startAdView } from "@/app/actions/like";

export type ActiveAd = {
  linkId: string;
  url: string;
  startedAt: number;
  source?: "boosted";
  starting?: boolean;
  startRequestId?: string;
  /** Ad-view JWT token returned by startAdView — only set after the server
   * confirms the ad-view start. Until then the timer MUST NOT fire. */
  token?: string;
};

type QueuedAd = { linkId: string; url: string; source?: "boosted" };

type AdStore = {
  active: ActiveAd[];
  queue: QueuedAd[];
  committed: Record<string, number>;
  viewed: Record<string, number>;
  maxSlots: number;
  adBlockerDetected: boolean;
  setAdBlockerDetected: (val: boolean) => void;
  enqueue: (linkId: string, url: string, maxSlots?: number, isBoosted?: boolean) => void;
  startNext: () => void;
  dismiss: (linkId: string) => void;
  markLoaded: (linkId: string) => void;
  clearAll: () => void;
  tickHeartbeat: () => void;
};

// ── Timer helpers ──────────────────────────────────────────────────────
// Two complementary mechanisms:
// 1. Per-ad setTimeout — precise timing in foreground, no race conditions.
// 2. Safety-net setInterval — catches ads whose setTimeout was throttled
//    (Chromium throttles background-tab timers to ≥1 min; PiP mode relies
//    on this fallback).  The interval only fires for ads that are ≥2 s past
//    their expected completion, so in normal foreground operation it never
//    fires and setTimeout remains the sole completion path.

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const SAFETY_TICK_MS = 2000;
const SAFETY_OVERDUE_MS = TOTAL_AD_SECONDS * 1000 + 2000; // 2 s grace after expected completion
const finalisingIds = new Set<string>();

let safetyInterval: ReturnType<typeof setInterval> | null = null;

function ensureSafetyInterval() {
  if (safetyInterval) return;
  safetyInterval = setInterval(() => {
    const { active } = useAdStore.getState();
    const now = Date.now();
    for (const ad of active) {
      if (
        ad.startedAt > 0 &&
        ad.token &&
        !finalisingIds.has(ad.linkId) &&
        now - ad.startedAt >= SAFETY_OVERDUE_MS
      ) {
        finalisingIds.add(ad.linkId);
        clearTimer(ad.linkId); // prevent the original (throttled) setTimeout from firing
        void commitAndFinalise(ad.linkId, ad.token!, ad.source);
      }
    }
  }, SAFETY_TICK_MS);
}

function teardownSafetyInterval() {
  if (safetyInterval) {
    clearInterval(safetyInterval);
    safetyInterval = null;
  }
}

function clearTimer(linkId: string) {
  const t = timers.get(linkId);
  if (t) {
    clearTimeout(t);
    timers.delete(linkId);
  }
}

// ── Commit helpers ──────────────────────────────────────────────────────

/** Returns true if the commit succeeded, false if it's a permanent rejection
 *  (exposure limit, burst cap, cooldown, etc.), and throws on network errors
 *  so the caller can distinguish transient failures worth retrying. */
async function commitLike(
  linkId: string,
  token: string,
  source?: "boosted",
): Promise<boolean> {
  try {
    const res = await commitLikeAction(linkId, source, token);
    if (!res.ok) {
      console.warn("[commitLike] Rejected for linkId:", linkId, "Reason:", res.error);
    }
    return res.ok;
  } catch (err) {
    console.error("[commitLike] Network error:", err);
    throw err;
  }
}

/** Commits the like (with retries on network errors), updates store, and
 *  dispatches the appropriate stats event.
 *  stats_updated fires only after the server confirms the database commit;
 *  failed commits trigger stats_sync so the UI can reconcile. */
async function commitAndFinalise(
  linkId: string,
  token: string,
  source?: "boosted",
) {
  // Hide the link as soon as the required view duration is complete. The
  // server result still decides whether the like count is incremented.
  useAdStore.setState((s) => ({
    viewed: { ...s.viewed, [linkId]: (s.viewed[linkId] ?? 0) + 1 },
  }));

  // ── Server commit (background) ────────────────────────────────────
  let ok = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      ok = await commitLike(linkId, token, source);
      break; // definitive answer — stop retrying
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  // Dispatch stats_updated ONLY when the server confirms successful DB insertion
  if (ok && typeof window !== "undefined") {
    window.dispatchEvent(new Event("stats_updated"));
  } else if (!ok && typeof window !== "undefined") {
    window.dispatchEvent(new Event("stats_sync"));
  }

  useAdStore.setState((s) => ({
    active: s.active.filter((a) => a.linkId !== linkId),
    committed: ok
      ? { ...s.committed, [linkId]: (s.committed[linkId] ?? 0) + 1 }
      : s.committed,
  }));

  finalisingIds.delete(linkId);
  useAdStore.getState().startNext();
}

// ── Store ───────────────────────────────────────────────────────────────

export const useAdStore = create<AdStore>((set, get) => {
  function addToActive(linkId: string, url: string, isBoosted?: boolean) {
    set((s) => ({
      active: [
        ...s.active,
        { linkId, url, startedAt: 0, source: isBoosted ? "boosted" : undefined },
      ],
    }));
  }

  return {
    active: [],
    queue: [],
    committed: {},
    viewed: {},
    maxSlots: MAX_CONCURRENT_ADS,
    adBlockerDetected: false,
    setAdBlockerDetected: (val) => set({ adBlockerDetected: val }),

    enqueue: (linkId, url, userMaxSlots = MAX_CONCURRENT_ADS, isBoosted) => {
      const { active, queue } = get();
      const maxSlots = Math.min(userMaxSlots, MAX_CONCURRENT_ADS);
      set({ maxSlots });
      if (active.some((a) => a.linkId === linkId)) return;
      if (queue.some((a) => a.linkId === linkId)) return;
      if (active.length >= maxSlots) {
        set({
          queue: [
            ...queue,
            { linkId, url, source: isBoosted ? "boosted" : undefined },
          ],
        });
        return;
      }
      addToActive(linkId, url, isBoosted);
      ensureSafetyInterval();
    },

    startNext: () => {
      const { active, queue, maxSlots } = get();
      if (active.length >= maxSlots) return;
      if (queue.length === 0) {
        // No more queued ads — if nothing is active either, tear down the
        // safety interval to avoid a permanent background tick.
        if (active.length === 0) teardownSafetyInterval();
        return;
      }

      const needed = maxSlots - active.length;
      const nextBatch = queue.slice(0, needed);
      const rest = queue.slice(needed);

      set({ queue: rest });
      for (const item of nextBatch) {
        addToActive(item.linkId, item.url, item.source === "boosted");
      }
      ensureSafetyInterval();
    },

    markLoaded: (linkId) => {
      const { active } = get();
      const ad = active.find((a) => a.linkId === linkId);
      if (!ad || ad.startedAt !== 0 || ad.starting) return;

      const startRequestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      set((s) => ({
        active: s.active.map((a) =>
          a.linkId === linkId ? { ...a, starting: true, startRequestId } : a,
        ),
      }));

      (async () => {
        try {
          const result = await startAdView(linkId, ad.source);
          const current = get().active.find((a) => a.linkId === linkId);
          if (!current || current.startRequestId !== startRequestId) return;

          if (!("token" in result)) {
            console.warn('[markLoaded] startAdView rejected:', linkId, result.error);
            set((s) => ({
              active: s.active.filter((a) => a.linkId !== linkId),
            }));
            get().startNext();
            return;
          }

          const viewStartMs = Date.now();
          set((s) => ({
            active: s.active.map((a) =>
              a.linkId === linkId
                ? { ...a, startedAt: viewStartMs, starting: false, startRequestId: undefined, token: result.token }
                : a,
            ),
          }));

          clearTimer(linkId);
          timers.set(
            linkId,
            setTimeout(() => {
              timers.delete(linkId);
              if (!finalisingIds.has(linkId)) {
                finalisingIds.add(linkId);
                void commitAndFinalise(linkId, result.token, ad.source);
              }
            }, TOTAL_AD_SECONDS * 1000),
          );
        } catch (err) {
          const current = get().active.find((a) => a.linkId === linkId);
          if (!current || current.startRequestId !== startRequestId) return;
          console.error('[markLoaded] startAdView failed for linkId:', linkId, err);
          clearTimer(linkId);
          set((s) => ({
            active: s.active.filter((a) => a.linkId !== linkId),
          }));
          get().startNext();
        }
      })();
    },

    dismiss: (linkId) => {
      clearTimer(linkId);
      finalisingIds.delete(linkId);
      set((s) => ({ active: s.active.filter((a) => a.linkId !== linkId) }));
      get().startNext();
    },

    clearAll: () => {
      const { active } = get();
      for (const ad of active) {
        clearTimer(ad.linkId);
        finalisingIds.delete(ad.linkId);
      }
      set({ active: [], queue: [] });
      teardownSafetyInterval();
    },

    tickHeartbeat: () => {
      const { active } = get();
      const now = Date.now();
      for (const ad of active) {
        if (
          ad.startedAt > 0 &&
          ad.token &&
          !finalisingIds.has(ad.linkId) &&
          now - ad.startedAt >= TOTAL_AD_SECONDS * 1000
        ) {
          finalisingIds.add(ad.linkId);
          clearTimer(ad.linkId);
          void commitAndFinalise(ad.linkId, ad.token, ad.source);
        }
      }
    },
  };
});
