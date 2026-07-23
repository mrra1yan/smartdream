"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAdStore } from "@/lib/ad-store";

export function CacheClearButton() {
  const activeAds = useAdStore((s) => s.active);
  const hasActiveAds = activeAds.length > 0;
  const [mounted, setMounted] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleClick = useCallback(() => {
    if (clearing) return;
    setClearing(true);

    if (typeof window !== "undefined" && (window as any).ReactNativeWebView) {
      // Native clears the WebView's cache and reloads it right after
      // receiving this -- that reload is the confirmation, nothing further
      // to do here.
      (window as any).ReactNativeWebView.postMessage(
        JSON.stringify({ type: "CLEAR_CACHE" })
      );
      return;
    }

    // Plain-browser fallback (no native bridge to ask): clear what's
    // actually reachable from here before reloading.
    (async () => {
      try {
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
      } catch {
        // best-effort
      }
      sessionStorage.clear();
      window.location.reload();
    })();
  }, [clearing]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={cn(
        "fixed right-4 md:right-8 z-[100] transition-all duration-300 [margin-bottom:env(safe-area-inset-bottom)]",
        hasActiveAds ? "bottom-[17.5rem]" : "bottom-24"
      )}
    >
      <motion.button
        type="button"
        onClick={handleClick}
        disabled={clearing}
        whileTap={{ scale: 0.92 }}
        className={cn(
          "relative flex h-12 w-12 items-center justify-center rounded-full border transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
          "bg-white dark:bg-zinc-900 border-primary/20 text-primary hover:bg-gray-50 dark:hover:bg-zinc-800",
          clearing && "cursor-not-allowed opacity-70"
        )}
        aria-label="Clear Cache"
      >
        {clearing ? (
          <Loader2 className="h-5 w-5 relative z-10 animate-spin text-primary" />
        ) : (
          <Trash2 className="h-5 w-5 relative z-10 text-primary" />
        )}
      </motion.button>
    </div>,
    document.body
  );
}
