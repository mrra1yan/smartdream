"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAdStore } from "@/lib/ad-store";
import { MAX_CONCURRENT_ADS } from "@/lib/types";

type FeedLink = { id: string; url: string };

type Status = {
  paidEnabled?: boolean;
  paidModel: string;
  freeUntil?: string | null;
  active: boolean;
  paused: boolean;
  remainingMinutes: number | null;
  remainingLikes: number | null;
};

/** Auto-like uses in-page modal popups only. */

/** Main loop tick interval in ms. Balances responsiveness with database load:
 *  - 1000ms = ~30 DB round-trips/min/user (original, too aggressive)
 *  - 5000ms = ~6 DB round-trips/min/user (5× reduction, still responsive)
 * Ads still complete on their own per-ad setTimeout (TOTAL_AD_SECONDS=9s),
 * so the tick only affects feed refill + progress display granularity. */
const LOOP_TICK_MS = 5000;
export function useAutoLike() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ liked: 0, failed: 0 });
  const [status, setStatus] = useState<Status | null>(null);
  const [linksExhausted, setLinksExhausted] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const runningRef = useRef(false);
  const exhaustedRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  const enqueuedRef = useRef<Set<string>>(new Set());
  const failedRef = useRef(0);
  const likedCountRef = useRef(0);
  const localQueueRef = useRef<FeedLink[]>([]);
  const prefetchRef = useRef<FeedLink[]>([]);
  const prefetchPromiseRef = useRef<Promise<void> | null>(null);
  const fetchFailStreakRef = useRef(0);
  const offsetRef = useRef(0);
  const noNewLinksStreakRef = useRef(0);
  const heartbeatListenerRef = useRef<((event: any) => void) | null>(null);

  const enqueue = useAdStore((s) => s.enqueue);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auto-like/status", { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || data.error || typeof data.active !== "boolean") {
        return null;
      }
      setStatus(data);
      return data as Status;
    } catch {
      return null;
    }
  }, []);

  const fetchBatch = useCallback(async (): Promise<FeedLink[]> => {
    try {
      // offsetRef always advances by exactly what the server returned, never
      // derived from seen/liked counts. getFeed() recomputes its ordered
      // list fresh on every call -- an owner whose given/received ratio
      // flips into deficit (e.g. from an earlier like in this very batch
      // landing) drops out entirely, along with ALL their links, shifting
      // everyone after them. A seen-minus-liked offset only ever accounts
      // for 1-for-1 removal on success and drifts further off with every
      // commit-time rejection (rate limit, or that same deficit flip), so a
      // single short/duplicate-heavy page from a stale offset doesn't mean
      // the pool is actually exhausted -- it means the list moved.
      const offset = offsetRef.current;
      const res = await fetch(`/api/feed?offset=${offset}&limit=50`);
      const data = await res.json();
      const links: FeedLink[] = data.links ?? [];

      if (links.length > 0) {
        offsetRef.current += links.length;
      } else if (offsetRef.current > 0) {
        // Reached end of feed at non-zero offset -- wrap back to offset 0
        // so subsequent requests re-check the top of the feed instead of
        // querying out-of-bounds offsets indefinitely.
        offsetRef.current = 0;
        const { active: currentActive, queue: currentQueue } = useAdStore.getState();
        const pendingIds = new Set([
          ...Array.from(enqueuedRef.current),
          ...currentActive.map((a) => a.linkId),
          ...currentQueue.map((q) => q.linkId),
        ]);
        seenRef.current = pendingIds;
      }

      const newLinks = links.filter((l) => !seenRef.current.has(l.id));
      for (const l of newLinks) {
        seenRef.current.add(l.id);
      }

      if (newLinks.length > 0) {
        noNewLinksStreakRef.current = 0;
      } else {
        noNewLinksStreakRef.current++;
        if (offsetRef.current > 0) {
          offsetRef.current = 0;
        }
      }
      // Only declare real exhaustion if even after resetting non-pending seenRef items there are still zero new links
      if (links.length < 50 && offset === 0 && noNewLinksStreakRef.current >= 3) {
        const { active: currentActive, queue: currentQueue } = useAdStore.getState();
        const pendingIds = new Set([
          ...Array.from(enqueuedRef.current),
          ...currentActive.map((a) => a.linkId),
          ...currentQueue.map((q) => q.linkId),
        ]);
        if (seenRef.current.size > pendingIds.size) {
          seenRef.current = pendingIds;
          noNewLinksStreakRef.current = 0;
        } else {
          exhaustedRef.current = true;
        }
      }

      fetchFailStreakRef.current = 0;
      return newLinks;
    } catch {
      // A network/parse failure here is not the same as genuinely running
      // out of links -- same null-vs-confirmed-inactive distinction as
      // refreshStatus() below. Marking exhaustedRef true on ANY dropped
      // request/timeout routed every transient blip straight into the
      // 3-retry-then-pause() spiral in loop(), silently turning auto-like
      // off over a single failed fetch instead of a real end-of-feed.
      // Leave exhaustedRef untouched so the next tick's "queue running low"
      // check just retries fetchBatch naturally; fetchFailStreakRef still
      // lets loop() pause on a genuinely dead connection instead of
      // retrying forever.
      fetchFailStreakRef.current++;
      return [];
    }
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    setRetrying(false);
    if (heartbeatListenerRef.current) {
      window.removeEventListener("message", heartbeatListenerRef.current);
      (document as any).removeEventListener("message", heartbeatListenerRef.current);
      heartbeatListenerRef.current = null;
    }
  }, []);

  const pause = useCallback(async () => {
    stop();
    setStatus((prev) => (prev ? { ...prev, paused: true, active: false } : prev));
    try {
      const res = await fetch("/api/auto-like/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof data.active === "boolean") {
        setStatus(data);
      }
    } catch {
      // Keep stopped on error
    }
  }, [stop]);

  const resume = useCallback(async () => {
    setStatus((prev) => {
      if (!prev) return prev;
      const isPaid = Boolean(prev.paidModel && prev.paidModel !== "none" && prev.paidEnabled !== false);
      const hasFree = Boolean(prev.freeUntil && new Date(prev.freeUntil).getTime() > Date.now());
      return {
        ...prev,
        paused: false,
        active: isPaid || hasFree || prev.active,
      };
    });
    try {
      const res = await fetch("/api/auto-like/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && typeof data.active === "boolean") {
        setStatus(data);
        return data as Status;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const start = useCallback(
    async (overrideStatus?: Status) => {
      if (runningRef.current) return;
      const st = overrideStatus || (await refreshStatus());
      if (!st?.active || st?.paused) return;

      runningRef.current = true;
      setRunning(true);
      setLinksExhausted(false);
      setRetrying(false);
      exhaustedRef.current = false;
      fetchFailStreakRef.current = 0;
      failedRef.current = 0;
      // A fresh scan of the feed's current state on every explicit resume,
      // rather than continuing from wherever offsetRef last stopped -- the
      // underlying list reorders/shrinks continuously as other users'
      // given/received ratios shift (see fetchBatch's comment), so a stale
      // offset from before this resume may no longer correspond to anything
      // meaningful. seenRef (not reset -- see below) still dedupes anything
      // already liked/failed that resurfaces during the re-scan.
      offsetRef.current = 0;
      noNewLinksStreakRef.current = 0;
      // enqueuedRef and likedCountRef deliberately are NOT reset here: they
      // can hold ids for ads that were still in flight in useAdStore
      // (active/queue) at the exact moment of a prior pause -- those keep
      // running via their own ad-store timers independent of runningRef,
      // and clearing enqueuedRef would stop the loop from ever crediting
      // their outcome once they complete after this restart.
      // If the mount-time prefetch is still in flight, wait for it instead
      // of snapshotting prefetchRef while it's still empty -- otherwise the
      // batch that fetch eventually returns is orphaned (fetchBatch already
      // marked its link ids "seen", but nothing ever queues them, silently
      // losing up to a full batch for this session) whenever start() is
      // called fast enough to race ahead of that first fetch resolving.
      if (prefetchPromiseRef.current) {
        await prefetchPromiseRef.current;
        prefetchPromiseRef.current = null;
      }
      // Reuse the batch prefetched on mount instead of throwing it away, so
      // the queue is actually instantly available on start -- but only as a
      // bootstrap for a genuinely empty queue. A restart after pause can
      // land here with localQueueRef still holding a real buffer (fetchBatch
      // keeps it topped up to ~25-50 links during normal running, well
      // beyond what 3 concurrent slots drain between ticks), and those ids
      // are already in seenRef -- unconditionally overwriting the queue with
      // prefetchRef (empty, on every run after the first) would silently
      // drop that whole buffer with no way to ever re-fetch it.
      if (localQueueRef.current.length === 0) {
        localQueueRef.current = prefetchRef.current;
      }
      prefetchRef.current = [];
      // Deliberately NOT resetting seenRef here. seenRef already contains
      // every id fetchBatch has ever returned this page session (including
      // everything in localQueueRef, added when it was fetched) -- it's the
      // one thing that must survive a stop()/start() cycle, so the
      // offsetRef=0 re-scan above doesn't waste a full ad-view cycle
      // re-attempting links already liked/failed/under the 12h per-pair
      // cooldown, only to hit a guaranteed server-side rejection again.
      useAdStore.getState().setAdBlockerDetected(false);
      const tickRef = { current: 0 };
      const retryCountRef = { current: 0 };
      const waitingForRetryRef = { current: false };
      const fetchingRef = { current: false };
      const lastLoopTimeRef = { current: Date.now() };

      const loop = async () => {
        if (!runningRef.current) return;
        lastLoopTimeRef.current = Date.now();

        if (useAdStore.getState().adBlockerDetected) {
          stop();
          return;
        }

        // Bounded ceiling for fetchBatch()'s consecutive-failure streak (see
        // its catch block) -- tolerates ordinary transient blips without
        // pausing, but still stops trying on a genuinely dead connection
        // instead of retrying every tick forever.
        if (fetchFailStreakRef.current >= 20) {
          void pause();
          return;
        }

        if (tickRef.current > 0 && tickRef.current % 20 === 0) {
          const latest = await refreshStatus();
          // refreshStatus() returns null on ANY fetch failure -- a dropped
          // packet, a WiFi/cellular handoff, a brief DNS blip, a slow cold
          // start -- indistinguishable here from a genuine server response.
          // Treating null the same as "server confirmed active: false" (the
          // old `!latest?.active` check did) meant a single transient
          // network hiccup during this ~20-second health check permanently
          // killed an otherwise-healthy session; over an hours-long run on a
          // mobile connection, hitting at least one such blip is likely, not
          // an edge case. Only stop on a real, parsed response that actually
          // says inactive -- a null (failed) check is silently skipped and
          // retried on the next tick-20 cycle instead.
          if (latest && !latest.active) {
            stop();
            return;
          }
        }
        tickRef.current++;

        const {
          active: currentActive,
          queue: currentQueue,
          committed: currentCommitted,
        } = useAdStore.getState();

        for (const linkId of Array.from(enqueuedRef.current)) {
          const isPending =
            currentActive.some((a) => a.linkId === linkId) ||
            currentQueue.some((q) => q.linkId === linkId);
          if (!isPending) {
            enqueuedRef.current.delete(linkId);
            if (currentCommitted[linkId]) likedCountRef.current++;
            else failedRef.current++;
          }
        }

        const totalPending = currentActive.length + currentQueue.length;

        // Check if we need to fetch a new batch
        if (localQueueRef.current.length === 0 && totalPending === 0) {
          if (exhaustedRef.current) {
            // If exhausted, wait until all pending ads finish
            // Instead of immediately pausing, retry after a delay
            if (retryCountRef.current < 2) {
              if (!waitingForRetryRef.current) {
                waitingForRetryRef.current = true;
                retryCountRef.current++;
                // Surfaced in the UI (see AutoLikeButton) so this 30s quiet
                // window reads as "still looking for more" instead of
                // silently looking indistinguishable from stopped.
                setRetrying(true);
                // Wait 30 seconds before retrying
                setTimeout(() => {
                  if (!runningRef.current) return;
                  void (async () => {
                    const latest = await refreshStatus();
                    if (!runningRef.current) return;
                    // Same null-vs-confirmed-inactive distinction as the
                    // tick-20 health check above -- a failed fetch here
                    // shouldn't cancel the retry, it should just proceed as
                    // if still active and let the next real check catch a
                    // genuine deactivation.
                    if (latest && !latest.active) {
                      stop();
                      return;
                    }
                    exhaustedRef.current = false;
                    seenRef.current = new Set();
                    failedRef.current = 0;
                    offsetRef.current = 0;
                    noNewLinksStreakRef.current = 0;
                    waitingForRetryRef.current = false;
                    setRetrying(false);
                    loop();
                  })();
                }, 30000);
                return; // Exit current loop; the setTimeout above will restart it
              }
              // Already waiting for retry, don't schedule another loop
              return;
            } else {
              // All retries exhausted -- genuinely nothing left right now
              // (not a network/parse blip, see fetchFailStreakRef's separate
              // pause path above, and not a server-confirmed inactive
              // status, see the refreshStatus checks above/below -- those
              // both return earlier). Surface this distinctly so the UI can
              // tell the user why it stopped instead of just going quiet.
              setLinksExhausted(true);
              void pause();
              return;
            }
          }
        }

        // Prefetch logic: load more when running low
        if (localQueueRef.current.length < 25 && !exhaustedRef.current && !fetchingRef.current) {
          fetchingRef.current = true;
          fetchBatch().then((batch) => {
            if (!runningRef.current) return;
            localQueueRef.current = [...localQueueRef.current, ...batch];
            if (batch.length > 0) {
              retryCountRef.current = 0;
            }
          }).finally(() => {
            fetchingRef.current = false;
          });
        }

        // Fill empty slots up to MAX_CONCURRENT_ADS
        const newTotalPending = currentActive.length + currentQueue.length;
        if (localQueueRef.current.length > 0 && newTotalPending < MAX_CONCURRENT_ADS) {
          const needed = MAX_CONCURRENT_ADS - newTotalPending;
          const toEnqueue = localQueueRef.current.slice(0, needed);
          localQueueRef.current = localQueueRef.current.slice(needed);

          for (const link of toEnqueue) {
            enqueuedRef.current.add(link.id);
            enqueue(link.id, link.url, MAX_CONCURRENT_ADS);
          }
        }

        const totalCommittedLikes = Object.values(currentCommitted).reduce(
          (sum, count) => sum + count,
          0
        );

        setProgress({
          liked: totalCommittedLikes,
          failed: failedRef.current,
        });

        if (runningRef.current) {
          setTimeout(loop, LOOP_TICK_MS);
        }
      };

      if (!heartbeatListenerRef.current) {
        heartbeatListenerRef.current = (event: any) => {
          try {
            let data = event.data;
            while (typeof data === "string") {
              try { data = JSON.parse(data); } catch { break; }
            }
            if (data && data.type === "HEARTBEAT" && runningRef.current) {
              if (Date.now() - lastLoopTimeRef.current >= 900) {
                loop();
              }
            }
          } catch { }
        };
        window.addEventListener("message", heartbeatListenerRef.current);
        (document as any).addEventListener("message", heartbeatListenerRef.current);
      }

      loop();
    },
    [enqueue, fetchBatch, refreshStatus, stop, pause],
  );

  // ── Reactive progress tracking ──────────────────────────────────────
  // The loop() above only updates progress once per tick (1 s). When the
  // loop is stopped (pause, exhaustion), ad-store timers keep firing and
  // committing likes, but progress freezes because nothing processes
  // enqueuedRef → likedSetRef. This subscription fills that gap: it reacts
  // to EVERY ad-store state change (active / queue / committed) and
  // immediately credits any enqueued link that just finished, regardless
  // of whether the loop is currently running.
  useEffect(() => {
    const unsub = useAdStore.subscribe((state, prevState) => {
      // Skip no-ops — only process when the relevant slices actually changed
      if (
        state.active === prevState.active &&
        state.queue === prevState.queue &&
        state.committed === prevState.committed
      )
        return;

      const { active: currentActive, queue: currentQueue, committed: currentCommitted } = state;

      let dirty = false;
      for (const linkId of Array.from(enqueuedRef.current)) {
        const isPending =
          currentActive.some((a) => a.linkId === linkId) ||
          currentQueue.some((q) => q.linkId === linkId);
        if (!isPending) {
          enqueuedRef.current.delete(linkId);
          if (currentCommitted[linkId]) likedCountRef.current++;
          else failedRef.current++;
          dirty = true;
        }
      }

      if (dirty) {
        const totalCommittedLikes = Object.values(currentCommitted).reduce(
          (sum, count) => sum + count,
          0
        );
        setProgress({
          liked: totalCommittedLikes,
          failed: failedRef.current,
        });
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    // Prefetch the first batch so it's instantly available when the user clicks start!
    if (prefetchRef.current.length === 0 && !exhaustedRef.current) {
      prefetchPromiseRef.current = fetchBatch().then(batch => {
        prefetchRef.current = batch;
      }).catch(() => {});
    }
    
    return () => {
      runningRef.current = false;
    };
  }, [fetchBatch]);

  const dismissLinksExhausted = useCallback(() => setLinksExhausted(false), []);

  return {
    running,
    progress,
    status,
    start,
    stop,
    refreshStatus,
    pause,
    resume,
    linksExhausted,
    dismissLinksExhausted,
    retrying,
  };
}
