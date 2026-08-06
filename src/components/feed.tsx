"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { LinkCard, type FeedLink } from "@/components/link-card";
import { useAdStore } from "@/lib/ad-store";
import { MAX_CONCURRENT_ADS } from "@/lib/types";

// How often buffered-but-unrendered links get flushed into the actually
// rendered list (see bufferRef below), and how often the list gets
// re-validated against a fresh scan.
const FLUSH_INTERVAL_MS = 800;
// likes_count freshness is bounded by this revalidate cycle -- there is no
// realtime subscription for it (removed: an unfiltered postgres_changes
// subscription on the entire `links` table broadcast every like anywhere in
// the app to every open feed tab regardless of relevance, which was a
// significant Supabase egress cost that scaled with likes × concurrent
// viewers rather than with actual relevance).
const REVALIDATE_INTERVAL_MS = 300_000; // 5 min — likes_count is cosmetic; realtime stats are live
// Cap background prefetch / revalidate pages. Unbounded pagination was
// hammering /api/feed (offset 0→400+) and saturating the Supabase path.
const MAX_PREFETCH_PAGES = 1; // SSR page + 1 more ≈ 100 links
const MAX_REVALIDATE_PAGES = 2;

/** Keep first occurrence of each link.id — prevents React duplicate-key errors. */
function dedupeById(list: FeedLink[]): FeedLink[] {
  const seen = new Set<string>();
  const out: FeedLink[] = [];
  for (const link of list) {
    if (seen.has(link.id)) continue;
    seen.add(link.id);
    out.push(link);
  }
  return out;
}

export function Feed({
  endpoint,
  initialLinks,
  initialOffset,
  maxSlots = MAX_CONCURRENT_ADS,
}: {
  endpoint: "/api/feed";
  initialLinks: FeedLink[];
  initialOffset: number;
  maxSlots?: number;
}) {
  const { t } = useI18n();
  const [links, setLinks] = useState<FeedLink[]>(() => dedupeById(initialLinks));
  const [loading, setLoading] = useState(initialLinks.length >= 50);
  // Fetched-but-not-yet-rendered links. A plain ref, not state -- pushing to
  // it doesn't trigger a re-render, so the background fetch loop below can
  // race through every page as fast as the network allows, completely
  // decoupled from how expensive rendering the (potentially very large)
  // link list is. The flush effect moves it into `links` in batches.
  const bufferRef = useRef<FeedLink[]>([]);
  // Ids already in state or buffer — skip duplicates on prefetch/revalidate race.
  const knownIdsRef = useRef<Set<string>>(new Set(initialLinks.map((l) => l.id)));

  // Hide links that have already been liked (committed)
  const committed = useAdStore((s) => s.committed);
  const viewed = useAdStore((s) => s.viewed);
  const visibleLinks = links.filter((link) => !committed[link.id] && !viewed[link.id]);

  const fetchPage = useCallback(
    async (nextOffset: number): Promise<number> => {
      try {
        const res = await fetch(`${endpoint}?offset=${nextOffset}&limit=50`);
        const data = await res.json();
        const incoming: FeedLink[] = data.links ?? [];
        for (const link of incoming) {
          if (knownIdsRef.current.has(link.id)) continue;
          knownIdsRef.current.add(link.id);
          bufferRef.current.push(link);
        }
        return incoming.length;
      } catch {
        return 0;
      }
    },
    [endpoint],
  );

  // Prefetch a bounded number of extra pages in the background. Auto-like
  // (use-autolike.ts) makes its own /api/feed calls and never reads this
  // component's state.
  useEffect(() => {
    if (initialLinks.length < 50) return; // SSR's first page already came up short -- nothing more to fetch
    let cancelled = false;

    (async () => {
      try {
        let currentOffset = initialOffset;
        let pages = 0;
        while (!cancelled && pages < MAX_PREFETCH_PAGES) {
          const fetched = await fetchPage(currentOffset);
          if (cancelled || fetched === 0) break;
          currentOffset += fetched;
          pages += 1;
          if (fetched < 50) break;
        }
      } catch {
        // Network error — leave existing links visible, just stop loading.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [endpoint, initialOffset, initialLinks.length, fetchPage]);

  // Moves whatever the background loop above has accumulated in bufferRef
  // into the actually-rendered list, in one batched update per tick instead
  // of one state update (and DOM reconciliation pass) per page fetched --
  // keeps re-render cost bounded no matter how fast the fetch loop runs.
  useEffect(() => {
    const interval = setInterval(() => {
      if (bufferRef.current.length === 0) return;
      const chunk = bufferRef.current.splice(0, bufferRef.current.length);
      setLinks((prev) => dedupeById([...prev, ...chunk]));
    }, FLUSH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Periodically re-scans a bounded window of eligible links and merges.
  useEffect(() => {
    const revalidate = async () => {
      let scanOffset = 0;
      let pages = 0;
      const freshLinks: FeedLink[] = [];
      while (pages < MAX_REVALIDATE_PAGES) {
        try {
          const res = await fetch(`${endpoint}?offset=${scanOffset}&limit=50`);
          const data = await res.json();
          const page: FeedLink[] = data.links ?? [];
          freshLinks.push(...page);
          pages += 1;
          if (page.length < 50) break;
          scanOffset += page.length;
        } catch {
          break; // stop fetching more pages on error, process what we have
        }
      }
      const fresh = dedupeById(freshLinks);
      const freshIds = new Set(fresh.map((l) => l.id));
      // Drop buffered rows the revalidate scan already covers (avoids flush dupes)
      bufferRef.current = bufferRef.current.filter((l) => !freshIds.has(l.id));
      setLinks((prev) => {
        const merged = dedupeById([
          ...fresh,
          ...prev.filter((l) => !freshIds.has(l.id)),
        ]);
        knownIdsRef.current = new Set([
          ...merged.map((l) => l.id),
          ...bufferRef.current.map((l) => l.id),
        ]);
        return merged;
      });
      setLoading(false);
    };

    if (visibleLinks.length === 0) {
      void revalidate();
    }

    // Skip the periodic full-list rescan while the tab/app is backgrounded --
    // nothing needs to happen while no one can see the result, and this is
    // now the only mechanism keeping likes_count fresh (see
    // REVALIDATE_INTERVAL_MS above).
    const interval = setInterval(() => {
      if (document.hidden) return;
      void revalidate();
    }, REVALIDATE_INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) void revalidate();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [endpoint, visibleLinks.length]);

  if (!loading && visibleLinks.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted">{t("home.feedEmpty")}</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {visibleLinks.map((link) => (
        <LinkCard key={link.id} link={link} maxSlots={maxSlots} />
      ))}
      {loading ? (
        <p className="py-4 text-center text-xs text-muted">{t("common.loading")}</p>
      ) : null}
    </div>
  );
}
