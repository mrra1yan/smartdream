"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Zap, ZapOff, Loader2, Link2Off, X } from "lucide-react";
import { useAutoLike } from "@/lib/use-autolike";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

import { useAdStore } from "@/lib/ad-store";

export function AutoLikeButton() {
  const { t, locale } = useI18n();
  const {
    running,
    progress,
    status,
    start,
    refreshStatus,
    pause,
    resume,
    linksExhausted,
    dismissLinksExhausted,
    retrying,
  } = useAutoLike();
  const activeAds = useAdStore((s) => s.active);
  const displayLikedCount = progress.liked;

  const hasActiveAds = activeAds.length > 0;
  const [mounted, setMounted] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
    void refreshStatus();
  }, [refreshStatus]);

  const toBengaliNumber = (num: number | string): string => {
    const str = String(num);
    if (locale !== "bn") return str;
    const bnDigits = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
    return str.replace(/[0-9]/g, (digit) => bnDigits[parseInt(digit)]);
  };

  const handleClick = async () => {
    if (!status || actionLoading) return;

    if (!status.active && !running && !status.paused) {
      window.location.href = "/premium";
      return;
    }

    setActionLoading(true);
    try {
      if (running) {
        await pause();
      } else if (status.paused) {
        const resumed = await resume();
        if (resumed && resumed.active) {
          void start(resumed);
        }
      } else {
        void start(status);
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Define styling classes based on state
  let buttonBg = "bg-white dark:bg-zinc-900 border-primary/20 text-primary hover:bg-gray-50 dark:hover:bg-zinc-800";
  let iconColor = "text-primary";
  let Icon = ZapOff;
  let showPulseRing = false;

  if (!status || actionLoading) {
    buttonBg = "bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 text-gray-400 cursor-not-allowed";
    iconColor = "text-gray-400";
    Icon = Loader2;
  } else if (!status.active && !running && !status.paused) {
    // Needs premium
    buttonBg = "bg-white dark:bg-zinc-900 border-primary/20 text-primary hover:bg-gray-50 dark:hover:bg-zinc-800";
    iconColor = "text-primary/70";
    Icon = ZapOff;
  } else if (running) {
    // ON state -- includes the ~30s quiet retry windows (see `retrying`),
    // which swap the icon to a spinner below so it doesn't look identical
    // to genuinely stopped.
    buttonBg = "bg-primary border-primary text-white shadow-lg shadow-primary/30 hover:bg-primary/90";
    iconColor = "text-white";
    Icon = retrying ? Loader2 : Zap;
    showPulseRing = true;
  } else {
    // OFF / Paused state
    buttonBg = "bg-white dark:bg-zinc-900 border-primary/30 text-primary shadow-md shadow-primary/10 hover:bg-gray-50 dark:hover:bg-zinc-800";
    iconColor = "text-primary";
    Icon = ZapOff;
  }

  if (!mounted) return null;

  return createPortal(
    <>
    {linksExhausted && (
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={dismissLinksExhausted}
          className="absolute inset-0 bg-black/60"
          aria-hidden="true"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 350, mass: 0.8 }}
          className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-2xl z-10"
        >
          <button
            type="button"
            onClick={dismissLinksExhausted}
            className="absolute top-4 right-4 rounded-full p-1.5 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-foreground transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
            <Link2Off className="h-6 w-6" />
          </div>
          <h2 className="text-center text-lg font-semibold">
            {t("autolike.linksExhaustedTitle")}
          </h2>
          <p className="mt-2 text-center text-sm text-muted">
            {t("autolike.linksExhaustedDesc")}
          </p>
          <button
            type="button"
            onClick={dismissLinksExhausted}
            className="mt-5 w-full rounded-2xl bg-accent text-white font-bold text-sm py-3 cursor-pointer hover:bg-accent/90 transition-colors"
          >
            {t("autolike.linksExhaustedOk")}
          </button>
        </motion.div>
      </div>
    )}
    <div className={cn(
      "fixed right-4 md:right-8 z-[100] transition-all duration-300 [margin-bottom:env(safe-area-inset-bottom)]",
      hasActiveAds ? "bottom-52" : "bottom-6"
    )}>
      {retrying && (
        <motion.div
          initial={{ opacity: 0, x: 4 }}
          animate={{ opacity: 1, x: 0 }}
          className="absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-full bg-black/80 px-3 py-1.5 text-[10px] font-bold text-white shadow-lg"
        >
          {t("autolike.searching")}
        </motion.div>
      )}
      <motion.button
        type="button"
        onClick={handleClick}
        disabled={!status || actionLoading}
        whileTap={{ scale: status ? 0.92 : 1 }}
        className={cn(
          "relative flex h-12 w-12 items-center justify-center rounded-full border transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
          buttonBg
        )}
        aria-label="Auto Like"
      >
        {showPulseRing && (
          <>
            <motion.span
              className="absolute inset-0 rounded-full bg-accent/40"
              animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.span
              className="absolute inset-0 rounded-full bg-accent/20"
              animate={{ scale: [1, 1.5, 1], opacity: [0.4, 0, 0.4] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
            />
          </>
        )}
        
        <Icon className={cn("h-5 w-5 relative z-10 transition-transform duration-200", 
          iconColor,
          Icon === Loader2 && "animate-spin",
          running && "animate-pulse text-white"
        )} />

        {/* Small Progress Badge — visible when running AND when paused so
            the user can see how many likes were given this session. */}
        {(running || status?.paused) && displayLikedCount > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-black text-white border border-background shadow-sm"
          >
            {toBengaliNumber(displayLikedCount)}
          </motion.div>
        )}
      </motion.button>
    </div>
    </>,
    document.body
  );
}
