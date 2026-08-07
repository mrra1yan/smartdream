"use client";

import { create } from "zustand";
import { MAX_CONCURRENT_ADS, TOTAL_AD_SECONDS } from "@/lib/types";
import { commitLikeAction, startAdView } from "@/app/actions/like";

export type ActiveAd = {
  linkId: string;
  url: string;
  /** 0 = not yet opened; >0 = timestamp when ad was first opened / user tapped
   *  the heart.  Set by setOpenedAt() — no longer waits for the server. */
  startedAt: number;
  source?: "boosted";
  /** true while startAdView() is in-flight */
  starting?: boolean;
  startRequestId?: string;
  /** Ad-view JWT token — only set after the server confirms the ad-view start.
   *  The 14 s timer starts from `startedAt`, not from when the token arrives. */
  token?: string;
};

type QueuedAd = { linkId: string; url: string; source?: "boosted" };

type AdStore = {
  active: ActiveAd[];
  queue: QueuedAd[];
  committed: Record<string, number>;
  viewed: Record<string, number>;
  skipped: Set<string>;
  maxSlots: number;
  adBlockerDetected: boolean;
  setAdBlockerDetected: (val: boolean) => void;
  enqueue: (linkId: string, url: string, maxSlots?: number, isBoosted?: boolean) => void;
  startNext: () => void;
  /** Called as soon as the ad is opened (heart tap / auto-open).  Records the
   *  wall-clock start time so the 14 s window is measured from the moment the
   *  user actually began viewing, not from when the token round-trip completed. */
  setOpenedAt: (linkId: string) => void;
  /** Fetches the ad-view token from the server.  Once the token arrives a
   *  precise setTimeout is armed for the *remaining* portion of the 14 s
   *  window (or the ad is committed immediately if the window already expired). */
  markLoaded: (linkId: string) => void;
  dismiss: (linkId: string) => void;
  clearAll: () => void;
  tickHeartbeat: () => void;
};

// ── Timer helpers ──────────────────────────────────────────────────────
// Three complementary mechanisms:
// 1. Per-ad setTimeout — precise timing, armed after the token arrives for the
//    exact remaining portion of the 14 s window (setOpenedAt records the start;
//    markLoaded arms the precise remaining timer).
// 2. Safety-net setInterval — catches ads whose setTimeout was throttled
//    (Chromium throttles background-tab timers to ≥1 min; PiP mode relies on
//    this fallback).  Also catches ads whose token took so long that no
//    setTimeout was ever armed.
// 3. tickHeartbeat — called from the native HEARTBEAT message for immediate
//    overdue checks without waiting for the next safety-net tick.

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
      // Ad whose timer never fired (throttled in background/PiP) — catch it.
      if (
        ad.startedAt > 0 &&
        ad.token &&
        !finalisingIds.has(ad.linkId) &&
        now - ad.startedAt >= SAFETY_OVERDUE_MS
      ) {
        finalisingIds.add(ad.linkId);
        clearTimer(ad.linkId);
        void commitAndFinalise(ad.linkId, ad.token, ad.source);
        continue;
      }
      // Ad that opened but NEVER got a token (startAdView permanently failed
      // or network is down).  After a generous grace period, dismiss it so the
      // slot is freed instead of being stuck forever.
      if (
        ad.startedAt > 0 &&
        !ad.token &&
        !ad.starting &&
        !finalisingIds.has(ad.linkId) &&
        now - ad.startedAt >= SAFETY_OVERDUE_MS + 10_000 // 16 s total grace
      ) {
        console.warn("[safetyNet] Dismissing stuck ad (no token after grace):", ad.linkId);
        finalisingIds.add(ad.linkId);
        clearTimer(ad.linkId);
        useAdStore.getState().dismiss(ad.linkId);
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
  // Notify auto-like that a slot freed up so it can fill it immediately
  // instead of waiting for the next loop tick (up to 5 s delay).
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("ad_slot_freed"));
  }
}

/** Arms a precise setTimeout for the remaining portion of the 14 s window.
 *  Must only be called after `startedAt` is set AND `token` is available. */
function armPreciseTimer(linkId: string, token: string, source?: "boosted") {
  const { active } = useAdStore.getState();
  const ad = active.find((a) => a.linkId === linkId);
  if (!ad || ad.startedAt <= 0) return;

  const elapsed = Date.now() - ad.startedAt;
  const totalWindowMs = TOTAL_AD_SECONDS * 1000;
  const remaining = Math.max(0, totalWindowMs - elapsed);

  clearTimer(linkId);

  if (remaining <= 0) {
    // Window already expired — commit immediately
    if (!finalisingIds.has(linkId)) {
      finalisingIds.add(linkId);
      void commitAndFinalise(linkId, token, source);
    }
    return;
  }

  timers.set(
    linkId,
    setTimeout(() => {
      timers.delete(linkId);
      if (!finalisingIds.has(linkId)) {
        finalisingIds.add(linkId);
        void commitAndFinalise(linkId, token, source);
      }
    }, remaining),
  );
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
    skipped: new Set(),
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

    /** Records the wall-clock time when the ad was first opened (heart tap or
     *  auto-open).  The 14 s window is measured from this moment — NOT from
     *  when the server token arrives.  This is called BEFORE the token is
     *  fetched so the UI can show an accurate countdown immediately. */
    setOpenedAt: (linkId) => {
      const { active } = get();
      const ad = active.find((a) => a.linkId === linkId);
      if (!ad || ad.startedAt > 0) return; // already opened

      const openedAt = Date.now();
      set((s) => ({
        active: s.active.map((a) =>
          a.linkId === linkId ? { ...a, startedAt: openedAt } : a,
        ),
      }));
    },

    /** Fetches the ad-view token from the server.  Once the token arrives,
     *  a precise setTimeout is armed for the *remaining* portion of the 14 s
     *  window — the timer starts from when `setOpenedAt` was called, not from
     *  when this function returns. */
    markLoaded: (linkId) => {
      const { active } = get();
      const ad = active.find((a) => a.linkId === linkId);
      // Must be in active, must have been opened (setOpenedAt called), must
      // not already be fetching a token, and must not already have one.
      if (!ad || ad.startedAt <= 0 || ad.starting || ad.token) return;

      const startRequestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      set((s) => ({
        active: s.active.map((a) =>
          a.linkId === linkId ? { ...a, starting: true, startRequestId } : a,
        ),
      }));

      (async () => {
        try {
          // Pass the client's actual ad-open time so the server can verify the
          // full 14 s elapsed, rather than measuring from server-receive time.
          // Also pass Date.now() as clientNowMs to eliminate clock skew.
          const clientStartedAtMs = ad.startedAt;
          const clientNowMs = Date.now();
          const result = await startAdView(linkId, ad.source, clientStartedAtMs, clientNowMs);
          const current = get().active.find((a) => a.linkId === linkId);
          if (!current || current.startRequestId !== startRequestId) return;

          if (!("token" in result)) {
            console.warn("[markLoaded] startAdView rejected:", linkId, result.error);
            set((s) => {
              const newSkipped = new Set(s.skipped);
              newSkipped.add(linkId);
              return {
                active: s.active.filter((a) => a.linkId !== linkId),
                skipped: newSkipped,
              };
            });
            get().startNext();
            if (typeof window !== "undefined") {
              window.dispatchEvent(new Event("ad_slot_freed"));
            }
            return;
          }

          set((s) => ({
            active: s.active.map((a) =>
              a.linkId === linkId
                ? { ...a, starting: false, startRequestId: undefined, token: result.token }
                : a,
            ),
          }));

          // Arm the precise timer for the remaining portion of the 14 s window.
          armPreciseTimer(linkId, result.token, ad.source);
        } catch (err) {
          const current = get().active.find((a) => a.linkId === linkId);
          if (!current || current.startRequestId !== startRequestId) return;
          console.error("[markLoaded] startAdView failed for linkId:", linkId, err);
          clearTimer(linkId);
          set((s) => ({
            active: s.active.filter((a) => a.linkId !== linkId),
          }));
          get().startNext();
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("ad_slot_freed"));
          }
        }
      })();
    },

    dismiss: (linkId) => {
      clearTimer(linkId);
      finalisingIds.delete(linkId);
      set((s) => ({ active: s.active.filter((a) => a.linkId !== linkId) }));
      get().startNext();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("ad_slot_freed"));
      }
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
