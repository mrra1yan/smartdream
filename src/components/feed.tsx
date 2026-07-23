"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { LinkCard, type FeedLink } from "@/components/link-card";
import { useAdStore } from "@/lib/ad-store";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { MAX_CONCURRENT_ADS } from "@/lib/types";

// How often buffered-but-unrendered links get flushed into the actually
// rendered list (see bufferRef below), and how often the full list gets
// re-validated against a fresh scan.
const FLUSH_INTERVAL_MS = 800;

export function Feed({
  endpoint,
  initialLinks,
  initialOffset,
  maxSlots = MAX_CONCURRENT_ADS,
}: {
  endpoint: "/api/feed" | "/api/boosted-feed";
  initialLinks: FeedLink[];
  initialOffset: number;
  maxSlots?: number;
}) {
  const { t } = useI18n();
  const [links, setLinks] = useState<FeedLink[]>(initialLinks);
  const [loading, setLoading] = useState(initialLinks.length >= 50);
  // Fetched-but-not-yet-rendered links. A plain ref, not state -- pushing to
  // it doesn't trigger a re-render, so the background fetch loop below can
  // race through every page as fast as the network allows, completely
  // decoupled from how expensive rendering the (potentially very large)
  // link list is. The flush effect moves it into `links` in batches.
  const bufferRef = useRef<FeedLink[]>([]);

  // Hide links that have already been liked (committed)
  const committed = useAdStore((s) => s.committed);
  const visibleLinks = links.filter((link) => !committed[link.id]);

  const fetchPage = useCallback(
    async (nextOffset: number): Promise<number> => {
      try {
        const res = await fetch(`${endpoint}?offset=${nextOffset}&limit=50`);
        const data = await res.json();
        const incoming: FeedLink[] = data.links ?? [];
        bufferRef.current.push(...incoming);
        return incoming.length;
      } catch {
        return 0;
      }
    },
    [endpoint],
  );

  // No scroll-to-load-more here -- the initial 50 render immediately, and
  // every remaining link keeps loading 50 at a time straight through in the
  // background, entirely independent of scroll position, until there's
  // genuinely nothing left. This is purely about what's rendered in this
  // list for a manually-browsing user; auto-like (use-autolike.ts) makes
  // its own independent /api/feed calls and never reads this component's
  // state either way.
  useEffect(() => {
    if (initialLinks.length < 50) return; // SSR's first page already came up short -- nothing more to fetch
    let cancelled = false;

    (async () => {
      let currentOffset = initialOffset;
      while (!cancelled) {
        const fetched = await fetchPage(currentOffset);
        if (cancelled || fetched === 0) break;
        currentOffset += fetched;
        if (fetched < 50) break;
      }
      if (!cancelled) setLoading(false);
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
      setLinks((prev) => [...prev, ...chunk]);
    }, FLUSH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Periodically re-scans the full current eligible list, prunes
  // anything no longer present, and merges any newly available links.
  useEffect(() => {
    const revalidate = async () => {
      const validIds = new Set<string>();
      let scanOffset = 0;
      const freshLinks: FeedLink[] = [];
      while (true) {
        try {
          const res = await fetch(`${endpoint}?offset=${scanOffset}&limit=50`);
          const data = await res.json();
          const page: FeedLink[] = data.links ?? [];
          for (const l of page) {
            validIds.add(l.id);
            freshLinks.push(l);
          }
          if (page.length < 50) break;
          scanOffset += page.length;
        } catch {
          return; // leave the list as-is on a failed scan
        }
      }
      setLinks((prev) => {
        const validPrev = prev.filter((l) => validIds.has(l.id));
        const prevIds = new Set(validPrev.map((l) => l.id));
        const newlyAdded = freshLinks.filter((l) => !prevIds.has(l.id));
        return [...validPrev, ...newlyAdded];
      });
      setLoading(false);
    };

    if (visibleLinks.length === 0) {
      void revalidate();
    }

    const interval = setInterval(() => {
      void revalidate();
    }, 15_000);
    return () => clearInterval(interval);
  }, [endpoint, visibleLinks.length]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel('public:links')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'links' },
        (payload) => {
          setLinks((currentLinks) =>
            currentLinks.map((l) =>
              l.id === payload.new.id
                ? { ...l, likesCount: payload.new.likes_count }
                : l
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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
