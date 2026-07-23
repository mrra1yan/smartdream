"use client";

import { create } from "zustand";
import { TOTAL_AD_SECONDS } from "@/lib/types";
import { commitLikeAction, startAdView } from "@/app/actions/like";

export type ActiveAd = {
  linkId: string;
  url: string;
  startedAt: number;
  source?: "boosted";
  /** Ad-view JWT token returned by startAdView — only set after the server
   *  confirms the ad-view start. Until then the timer MUST NOT fire. */
  token?: string;
};

type QueuedAd = { linkId: string; url: string; source?: "boosted" };

type AdStore = {
  active: ActiveAd[];
  queue: QueuedAd[];
  committed: Record<string, number>;
  maxSlots: number;
  adBlockerDetected: boolean;
  setAdBlockerDetected: (val: boolean) => void;
  enqueue: (linkId: string, url: string, maxSlots?: number, isBoosted?: boolean) => void;
  startNext: () => void;
  dismiss: (linkId: string) => void;
  markLoaded: (linkId: string) => void;
  clearAll: () => void;
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

function schedule(linkId: string, run: () => void) {
  clearTimer(linkId);
  timers.set(
    linkId,
    setTimeout(() => {
      timers.delete(linkId);
      run();
    }, TOTAL_AD_SECONDS * 1000),
  );
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
 *  stats_updated fires *before* the server call so the UI updates at the
 *  exact 7-second mark — the server response is handled as a background
 *  correction via stats_sync only on failure. */
async function commitAndFinalise(
  linkId: string,
  token: string,
  source?: "boosted",
) {
  // ── Optimistic UI update ──────────────────────────────────────────
  // Dispatch immediately so the stats card increments at the 7 s mark,
  // not 8-9 s later when the server finally responds.
  if (typeof window !== "undefined" && source !== "boosted") {
    window.dispatchEvent(new Event("stats_updated"));
  }

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

  // If the server rejected, fire stats_sync so the optimistic +1 above
  // gets corrected by a fresh server fetch.
  if (!ok && typeof window !== "undefined") {
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
    maxSlots: 4,
    adBlockerDetected: false,
    setAdBlockerDetected: (val) => set({ adBlockerDetected: val }),

    enqueue: (linkId, url, userMaxSlots = 4, isBoosted) => {
      const { active, queue } = get();
      set({ maxSlots: userMaxSlots });
      if (active.some((a) => a.linkId === linkId)) return;
      if (queue.some((a) => a.linkId === linkId)) return;
      if (active.length >= userMaxSlots) {
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
      if (!ad || ad.startedAt !== 0) return;

      // ── Start the countdown IMMEDIATELY for UX ──────────────────────
      const loadStartMs = Date.now();
      set((s) => ({
        active: s.active.map((a) =>
          a.linkId === linkId
            ? { ...a, startedAt: loadStartMs }
            : a,
        ),
      }));

      // ── Fetch token in background ──────────────────────────────────
      (async () => {
        const result = await startAdView(linkId, ad.source);
        const current = get().active.find((a) => a.linkId === linkId);
        if (!current) return; // dismissed while waiting

        if (!("token" in result)) {
          clearTimer(linkId);
          set((s) => ({
            active: s.active.filter((a) => a.linkId !== linkId),
          }));
          get().startNext();
          return;
        }

        set((s) => ({
          active: s.active.map((a) =>
            a.linkId === linkId
              ? { ...a, token: result.token }
              : a,
          ),
        }));

        // How much of the TOTAL_AD_SECONDS window has already elapsed?
        // If the server call took longer than the ad-view duration,
        // commit immediately — otherwise schedule for the remainder.
        const elapsed = Date.now() - loadStartMs;
        const remaining = TOTAL_AD_SECONDS * 1000 - elapsed;

        if (remaining <= 0) {
          void commitAndFinalise(linkId, result.token, ad.source);
        } else {
          clearTimer(linkId);
          timers.set(
            linkId,
            setTimeout(() => {
              timers.delete(linkId);
              void commitAndFinalise(linkId, result.token, ad.source);
            }, remaining),
          );
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
  };
});
