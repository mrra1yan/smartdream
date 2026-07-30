"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useAdStore } from "@/lib/ad-store";
import { AD_LOADING_SECONDS, AD_VIEW_SECONDS, TOTAL_AD_SECONDS } from "@/lib/types";
import { X } from "lucide-react";

/** Grace period to wait for Native's AD_LOADED before giving up on it. */
const AD_LOAD_FALLBACK_MS = 3000;

/**
 * Session nonce handed to us by native's BRIDGE_INIT handshake (see
 * MobileApp/App.tsx's dispatchToWeb). Deliberately module-level rather than
 * React state: it must survive across individual AdModal mounts/unmounts and
 * be available even if no AdModal exists yet when BRIDGE_INIT arrives (it's
 * dispatched once, right after the main WebView finishes loading, well
 * before any ad can be opened).
 *
 * Without this, `window.addEventListener("message", ...)` below would
 * accept AD_LOADED/AD_DISMISSED from *any* postMessage call made by
 * whatever is running in this page's origin (a compromised script, a rogue
 * ad tag, etc.), letting it fake "ad completed" without the ad ever
 * rendering -- impression fraud. This isn't meant to be bulletproof against
 * a fully compromised device (which could just read the nonce out of the
 * WebView's JS context); it only closes the trivial "any page content can
 * just postMessage a forged AD_LOADED" gap.
 */
let nativeBridgeNonce: string | null = null;

function parseNativeMessage(event: { data: unknown }): any {
  try {
    let data = event.data;
    while (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        break;
      }
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * In-page modal popups only — no window.open / no browser tabs.
 * Multiple ads = multiple modals stacked / side chips + active overlay.
 */
export function AdContainer() {
  const active = useAdStore((s) => s.active);
  const adBlockerDetected = useAdStore((s) => s.adBlockerDetected);
  const setAdBlockerDetected = useAdStore((s) => s.setAdBlockerDetected);
  const [mounted, setMounted] = useState(false);
  const [isNativeApp, setIsNativeApp] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsNativeApp(typeof window !== "undefined" && !!(window as any).ReactNativeWebView);
  }, []);

  // Registered here (mounted for the whole lifetime of the main app layout)
  // rather than per-AdModal, so the handshake nonce is captured as soon as
  // native sends it, independent of whether any ad is currently open.
  useEffect(() => {
    const handleBridgeInit = (event: any) => {
      const data = parseNativeMessage(event);
      if (data && data.type === "BRIDGE_INIT" && typeof data.nonce === "string" && data.nonce) {
        nativeBridgeNonce = data.nonce;
      }
    };
    window.addEventListener("message", handleBridgeInit);
    (document as any).addEventListener("message", handleBridgeInit);
    return () => {
      window.removeEventListener("message", handleBridgeInit);
      (document as any).removeEventListener("message", handleBridgeInit);
    };
  }, []);

  if (!mounted) return null;
  if (active.length === 0 && !adBlockerDetected) return null;

  return createPortal(
    <>
      {adBlockerDetected && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
          <div className="relative w-full max-w-md p-6 rounded-3xl border border-border/50 bg-surface shadow-2xl">
            <h3 className="text-lg font-black text-foreground mb-2">
              Ad load হচ্ছে না
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              VPN/proxy বন্ধ করুন এবং ad blocker off রাখুন।
            </p>
            <button
              type="button"
              onClick={() => setAdBlockerDetected(false)}
              className="w-full rounded-2xl bg-red-600 text-white font-extrabold text-xs py-3.5"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {active.length > 0 && isNativeApp && (
        <>
          {active.map((ad, i) => (
            <AdModal
              key={ad.linkId}
              linkId={ad.linkId}
              url={ad.url}
              startedAt={ad.startedAt}
              index={i}
            />
          ))}
        </>
      )}

      {active.length > 0 && !isNativeApp && (
        <div className="fixed inset-x-0 bottom-4 sm:bottom-6 z-50 flex flex-col items-center justify-end p-2 sm:p-4 pointer-events-none">
          <div className={`relative z-10 grid w-full max-w-[220px] sm:max-w-[260px] gap-2 pointer-events-auto ${active.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {active.map((ad, i) => (
              <AdModal
                key={ad.linkId}
                linkId={ad.linkId}
                url={ad.url}
                startedAt={ad.startedAt}
                index={i}
              />
            ))}
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}

function AdModal({
  linkId,
  url,
  startedAt,
  index = 0,
}: {
  linkId: string;
  url: string;
  startedAt: number;
  index?: number;
}) {
  const markLoaded = useAdStore((s) => s.markLoaded);
  const dismiss = useAdStore((s) => s.dismiss);
  const [now, setNow] = useState(Date.now());
  const [showAdOverlay, setShowAdOverlay] = useState(false);
  const isNativeApp = typeof window !== "undefined" && !!(window as any).ReactNativeWebView;

  useEffect(() => {
    if (startedAt <= 0) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [startedAt]);

  const elapsedSec = startedAt > 0 ? Math.floor((now - startedAt) / 1000) : 0;
  const elapsedCapped = Math.min(elapsedSec, TOTAL_AD_SECONDS);
  const isLoadingPhase = startedAt > 0 && elapsedCapped < AD_LOADING_SECONDS;
  const isOverdue = startedAt > 0 && elapsedSec > TOTAL_AD_SECONDS;
  
  const loadingRemaining = Math.max(0, AD_LOADING_SECONDS - elapsedCapped);
  const viewRemaining = Math.max(0, AD_VIEW_SECONDS - (elapsedCapped - AD_LOADING_SECONDS));
  const totalRemaining = Math.max(0, TOTAL_AD_SECONDS - elapsedCapped);

  const handleOpenAd = useCallback(() => {
    if (typeof window !== "undefined" && (window as any).ReactNativeWebView) {
      // Running inside Android App wrapper
      (window as any).ReactNativeWebView.postMessage(
        JSON.stringify({
          type: "OPEN_AD",
          url: url,
          linkId: linkId,
        })
      );
      // Don't call markLoaded here — the native WebView's onLoadEnd will
      // dispatch AD_LOADED which triggers markLoaded. A 3-second fallback
      // timeout (registered below) catches the case where AD_LOADED never
      // arrives. Calling markLoaded synchronously here creates a race where
      // both this call and the AD_LOADED handler can fire markLoaded.
      return true;
    }

    // Browser: use inline iframe overlay instead of popup (popup blockers
    // kill auto-like since there's no user gesture).  Same as the native
    // path: start the timer immediately — the ad loads in the overlay.
    setShowAdOverlay(true);
    if (startedAt === 0) {
      markLoaded(linkId);
    }
    return true;
  }, [url, linkId, startedAt, markLoaded]);

  // Attempt auto-open on mount if not started, with stagger to prevent WebView crashes
  useEffect(() => {
    if (startedAt === 0) {
      const timer = setTimeout(() => {
        handleOpenAd();
      }, index * 300 + 100);
      return () => clearTimeout(timer);
    }
  }, [startedAt, handleOpenAd, index]);

  // Safety net: Native's AD_LOADED can be lost forever — a dead link, a
  // redirect loop, or Native silently evicting this ad from its own 3-slot
  // queue (see MobileApp/App.tsx onMainMessage) all leave nothing to ever
  // call markLoaded. Without a timeout the slot stays stuck permanently,
  // since only a manual tap on Native's close button frees it. Proceed after
  // a grace period, same as the desktop path which never waits for
  // load confirmation at all.
  useEffect(() => {
    if (!isNativeApp || startedAt !== 0) return;
    const fallback = setTimeout(() => {
      markLoaded(linkId);
    }, AD_LOAD_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [isNativeApp, startedAt, linkId, markLoaded]);

  // Tell Native app to close its modal when this React component unmounts
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && (window as any).ReactNativeWebView) {
        (window as any).ReactNativeWebView.postMessage(
          JSON.stringify({
            type: "CLOSE_AD",
            linkId: linkId,
          })
        );
      }
    };
  }, [linkId]);

  // Listen for messages from React Native app
  useEffect(() => {
    const handleNativeMessage = (event: any) => {
      const data = parseNativeMessage(event);
      if (!data) return;

      if (data.type === "AD_DISMISSED" || data.type === "AD_LOADED") {
        if (data.nonce && typeof data.nonce === "string") {
          if (!nativeBridgeNonce) {
            nativeBridgeNonce = data.nonce;
          } else if (data.nonce !== nativeBridgeNonce) {
            return;
          }
        }
      } else if (data.type === "HEARTBEAT") {
        useAdStore.getState().tickHeartbeat();
        // ── Sync active ads to native so the PiP popup updates even when
        //     Chromium throttles React re-renders in the background. Without
        //     this, ads commit correctly (thanks to tickHeartbeat) but the
        //     visual popup never shows new ads, because the OPEN_AD/CLOSE_AD
        //     messages sent from AdModal mount/unmount are gated on throttled
        //     React renders. Posting directly from the HEARTBEAT handler
        //     bypasses that throttle.
        if ((window as any).ReactNativeWebView) {
          const active = useAdStore.getState().active;
          (window as any).ReactNativeWebView.postMessage(
            JSON.stringify({
              type: "SYNC_ADS",
              ads: active.map((a) => ({ url: a.url, linkId: a.linkId })),
            }),
          );
        }
      }

      if (data.type === "AD_DISMISSED" && data.linkId === linkId) {
        dismiss(linkId);
      } else if (data.type === "AD_LOADED" && data.linkId === linkId) {
        if (startedAt === 0) {
          markLoaded(linkId);
        }
      }
    };
    window.addEventListener("message", handleNativeMessage);
    (document as any).addEventListener("message", handleNativeMessage);
    
    return () => {
      window.removeEventListener("message", handleNativeMessage);
      (document as any).removeEventListener("message", handleNativeMessage);
    };
  }, [linkId, startedAt, dismiss, markLoaded]);

  if (isNativeApp) {
    return null;
  }

  return (
    <>
      {/* Compact bottom chip — always visible when ad is active */}
      <div className="relative w-full overflow-hidden rounded-xl border border-border/50 bg-black shadow-2xl">
        <div className="flex items-center justify-between gap-1 border-b border-white/10 bg-zinc-950 px-2 py-1.5">
          <span className="text-[9px] font-black uppercase tracking-wide text-white/80">
            {startedAt <= 0
              ? "Ad view · Pending"
              : isOverdue
              ? "Completing..."
              : isLoadingPhase
              ? `Loading ad · ${loadingRemaining}s`
              : `Ad view · ${viewRemaining}s`}
          </span>
          <button
            type="button"
            onClick={() => dismiss(linkId)}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Close ad"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        <div className="relative w-full bg-zinc-900 flex flex-col items-center justify-center p-2 text-center min-h-[60px]">
          {startedAt === 0 ? (
            <>
              <p className="text-zinc-400 mb-1.5 text-[9px] max-w-[160px] leading-tight">
                Waiting to start...
              </p>
              <button
                onClick={handleOpenAd}
                className="bg-accent text-white px-3 py-1 rounded-full font-bold text-[9px] shadow hover:scale-105 transition-transform active:scale-95"
              >
                View Ad
              </button>
            </>
          ) : (
            <>
              <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin mb-1.5" />
              <p className="text-white font-medium text-[10px]">
                {isOverdue ? "Completing..." : isLoadingPhase ? "Loading ad..." : "Viewing ad..."}
              </p>
              <p className="text-zinc-500 text-[9px] mt-0.5">
                {isOverdue ? "Please wait" : `Wait ${isLoadingPhase ? `${loadingRemaining}s` : `${viewRemaining}s`}`}
              </p>
              
              <button 
                onClick={() => setShowAdOverlay(true)}
                className="mt-2 text-[9px] text-accent underline underline-offset-2 opacity-70 hover:opacity-100"
              >
                Show ad
              </button>
            </>
          )}

          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-1 bg-black/40">
            <div
              className="h-full bg-accent transition-[width] duration-200 ease-linear"
              style={{
                width:
                  startedAt <= 0
                    ? "0%"
                    : `${Math.min(100, Math.max(0, (elapsedCapped / TOTAL_AD_SECONDS) * 100))}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Fullscreen iframe overlay — shown when the ad is being viewed */}
      {showAdOverlay && startedAt > 0 && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black">
          {/* Top bar with countdown and close */}
          <div className="flex items-center justify-between gap-2 bg-zinc-950 border-b border-white/10 px-3 py-2 shrink-0">
            <span className="text-xs font-black uppercase tracking-wide text-white/80">
              {isOverdue
                ? "Completing..."
                : isLoadingPhase
                ? `Loading ad · ${loadingRemaining}s`
                : `Viewing ad · ${viewRemaining}s`}
            </span>
            <div className="flex items-center gap-2">
              {/* Progress bar in header */}
              <div className="w-24 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-accent transition-[width] duration-200 ease-linear"
                  style={{
                    width: `${Math.min(100, Math.max(0, (elapsedCapped / TOTAL_AD_SECONDS) * 100))}%`,
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowAdOverlay(false)}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                aria-label="Minimize ad"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          
          {/* Ad iframe — routed through /api/ad-serve proxy for header
>               enrichment (Referer, Origin, Sec-Fetch-*, GEO) → higher CPM */}
          <iframe
            src={`/api/ad-serve?url=${encodeURIComponent(url)}`}
            className="flex-1 w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-popups"
            title="Ad content"
          />
        </div>
      )}
    </>
  );
}
