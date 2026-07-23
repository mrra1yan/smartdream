"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Gift, Link2 } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { LinkCard, type FeedLink } from "@/components/link-card";
import { motion } from "framer-motion";
import { useAdStore } from "@/lib/ad-store";
import { MAX_CONCURRENT_ADS } from "@/lib/types";

type Offer = { required: number; minutes: number; progress: number; active: boolean };

export function BoostedFeed({
  initialLinks,
  initialOffset,
  initialOffer,
  maxSlots = MAX_CONCURRENT_ADS,
}: {
  initialLinks: FeedLink[];
  initialOffset: number;
  initialOffer: Offer;
  maxSlots?: number;
}) {
  const { t, locale } = useI18n();
  const [links, setLinks] = useState<FeedLink[]>(initialLinks);
  const [offset, setOffset] = useState(initialOffset);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialLinks.length >= 50);
  const [offer] = useState<Offer>(initialOffer);
  const sentinel = useRef<HTMLDivElement>(null);

  const toBengaliNumber = (num: number | string): string => {
    const str = String(num);
    if (locale !== "bn") return str;
    const bnDigits = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
    return str.replace(/[0-9]/g, (digit) => bnDigits[parseInt(digit)]);
  };

  const loadMore = useCallback(async (nextOffset: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/boosted-feed?offset=${nextOffset}&limit=50`);
      const data = await res.json();
      const incoming: FeedLink[] = data.links ?? [];
      setLinks((prev) => [...prev, ...incoming]);
      setOffset(nextOffset + incoming.length);
      if (incoming.length < 50) setHasMore(false);
    } catch {
      // swallow
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading) {
          void loadMore(offset);
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadMore, offset]);

  const committed = useAdStore((s) => s.committed);
  const visibleLinks = links.filter((link) => !committed[link.id]);

  useEffect(() => {
    const refreshBoosted = async () => {
      try {
        const res = await fetch(`/api/boosted-feed?offset=0&limit=50`);
        const data = await res.json();
        const incoming: FeedLink[] = data.links ?? [];
        if (incoming.length > 0) {
          setLinks((prev) => {
            const existingIds = new Set(prev.map((l) => l.id));
            const newlyAdded = incoming.filter((l) => !existingIds.has(l.id));
            if (newlyAdded.length === 0) return prev;
            return [...prev, ...newlyAdded];
          });
        }
      } catch {
        // ignore
      }
    };

    if (visibleLinks.length === 0) {
      void refreshBoosted();
    }

    const interval = setInterval(() => {
      void refreshBoosted();
    }, 15_000);
    return () => clearInterval(interval);
  }, [visibleLinks.length]);
  const totalCommittedBoosted = links.reduce((sum, link) => sum + (committed[link.id] || 0), 0);
  // offer.progress is a page-load snapshot of boosted_offer_count, which the
  // server resets to 0 (and grants a free-autolike credit) every time it
  // hits offer.required (process_like_commit, migration 0005) -- it cycles,
  // it doesn't count up forever. Clamping with Math.min(offer.required, ...)
  // instead of wrapping meant that once a session's commits pushed the raw
  // total past offer.required once, the bar got stuck showing "complete"
  // permanently, even though the server had already reset and started a new
  // cycle the user was actively making fresh progress on. Modulo mirrors the
  // server's own reset-on-completion behavior instead.
  const rawProgress = offer.progress + totalCommittedBoosted;
  const currentProgress = offer.required > 0 ? rawProgress % offer.required : 0;

  const progressPercent = offer.required > 0 ? (currentProgress / offer.required) * 100 : 0;

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Boosted Offer Progress Box */}
      {offer.active !== false && (
        <div className="relative overflow-hidden rounded-3xl border border-accent/20 bg-accent/5 p-6 shadow-xl flex items-start gap-4">
          {/* Ambient glows */}
          <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-accent/10 blur-xl" />

          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-purple-600 text-white shadow-lg shadow-accent/20">
            <Gift className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-extrabold text-foreground leading-snug">
              {t("boosted.offer", {
                required: toBengaliNumber(offer.required),
                minutes: toBengaliNumber(offer.minutes),
              })}
            </h2>
            
            {/* Progress bar */}
            <div className="mt-3.5 h-2.5 w-full overflow-hidden rounded-full bg-background border border-border/30 shadow-inner">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="h-full bg-gradient-to-r from-accent to-purple-600 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.2)]"
              />
            </div>
            
            <p className="mt-2 text-xs font-bold text-muted-foreground/80 flex items-center justify-between">
              <span>{t("boosted.progress")}</span>
              <span className="text-foreground">
                {toBengaliNumber(currentProgress)}
                <span className="text-muted-foreground/60">/{toBengaliNumber(offer.required)}</span>
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Feed Links List */}
      {!loading && visibleLinks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-3xl border border-dashed border-border/60 bg-surface/10">
          <Link2 className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-bold text-muted-foreground/80">
            {t("home.feedEmpty")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {visibleLinks.map((link) => (
            <LinkCard key={link.id} link={link} maxSlots={maxSlots} />
          ))}
        </div>
      )}
      
      <div ref={sentinel} className="h-1" />
      {loading ? (
        <p className="py-6 text-center text-xs font-bold text-muted-foreground/70 animate-pulse">
          {t("common.loading")}
        </p>
      ) : null}
    </div>
  );
}
