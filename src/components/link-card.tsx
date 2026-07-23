"use client";

import { useMemo } from "react";
import { Heart, Loader2, Link2 } from "lucide-react";
import { useAdStore } from "@/lib/ad-store";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { MAX_CONCURRENT_ADS } from "@/lib/types";

export type FeedLink = {
  id: string;
  url: string;
  likesCount: number;
  anonymous?: boolean;
  isBoosted?: boolean;
};

export function LinkCard({ link, maxSlots = MAX_CONCURRENT_ADS }: { link: FeedLink; maxSlots?: number }) {
  const enqueue = useAdStore((s) => s.enqueue);
  const active = useAdStore((s) => s.active);

  const viewing = active.some((a) => a.linkId === link.id);
  const isLiking = useAdStore(
    (s) =>
      s.active.some((a) => a.linkId === link.id) ||
      s.queue.some((q) => q.linkId === link.id),
  );

  const domain = useMemo(() => {
    try {
      return new URL(link.url).hostname.replace(/^www\./, "");
    } catch {
      return link.url.slice(0, 28);
    }
  }, [link.url]);

  const onLike = () => {
    if (viewing) return;
    // In-page modal popup only — never browser tab/window.
    enqueue(link.id, link.url, maxSlots, link.isBoosted);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={isLiking ? { opacity: 0.5, y: 0, scale: 0.98 } : { opacity: 1, y: 0 }}
      className="group relative flex items-center justify-between gap-4 overflow-hidden rounded-3xl border border-border/40 bg-surface/90 p-5 shadow-lg transition-all hover:border-accent/40 hover:shadow-xl"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-accent/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="absolute -right-8 -top-8 h-20 w-20 rounded-full bg-accent/5 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      <div className="relative min-w-0 flex-1 flex items-center gap-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background shadow-sm border border-border/40 group-hover:border-accent/30 transition-colors">
          <Link2 className="h-5 w-5 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <p className="truncate text-sm font-extrabold text-foreground group-hover:text-accent transition-colors">
              {domain}
            </p>
            {link.isBoosted && (
              <span className="inline-flex items-center rounded-full bg-accent/15 px-2 py-0.5 text-[9px] font-black uppercase text-accent border border-accent/20 shrink-0">
                Boosted
              </span>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onLike}
        disabled={viewing}
        aria-label="Like and view ad"
        className={cn(
          "relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition-all duration-300 cursor-pointer shadow-sm",
          viewing
            ? "border-zinc-300 bg-zinc-100 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-600"
            : "border-accent/30 bg-accent/5 text-accent hover:border-accent hover:bg-accent hover:text-white",
        )}
      >
        {viewing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Heart className="h-4 w-4 text-accent group-hover:text-white transition-colors" />
        )}
      </button>
    </motion.div>
  );
}
