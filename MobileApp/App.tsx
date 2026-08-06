import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Modal,
  Linking,
  BackHandler,
  AppState,
  DeviceEventEmitter,
  NativeModules,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import NetInfo from '@react-native-community/netinfo';

const WebViewComponent = WebView as any;

const CONFIG_URL = 'https://sd.docstec.cloud/api/app-version';
const APP_VERSION = '1.0.0';
const DEFAULT_WEB_URL = 'https://sd.docstec.cloud';
const DEFAULT_DOWNLOAD_URL = 'https://github.com/nurulhudda247/SmartDream-Releases/releases/latest/download/SmartDream.apk';

const ALLOWED_WEB_HOSTS = ['sd.docstec.cloud'];
const ALLOWED_DOWNLOAD_HOSTS = ['github.com'];

// ── Ad timing ──────────────────────────────────────────────────────────
// MUST stay synchronised with web layer src/lib/types.ts:
//   TOTAL_AD_SECONDS = AD_LOADING_SECONDS + AD_VIEW_SECONDS = 4 + 10 = 14
// The native visual timer uses `startedAt` supplied by the web in each
// OPEN_AD message, so both layers measure from the same wall-clock moment.
const TOTAL_AD_MS = 14000;       // = TOTAL_AD_SECONDS * 1000
const TIMER_TICK_MS = 1000;
const MAX_DISPLAY_ADS = 3;
/** Extra grace period before replacing a full slot when a new OPEN_AD
 *  arrives — avoids flicker from sub-second timer drift. */
const DISPLAY_FULL_GRACE_MS = 500;

type AdInfo = {
  url: string;
  linkId: string;
  /** When the native renderer received the ad (OPEN_AD / SYNC_ADS). */
  startedAt: number;
  /** When the ad WebView finished loading (onLoadEnd). */
  loadedAt?: number;
};

function parseHttpUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed;
  } catch {
    return null;
  }
}

function isHttpUrl(value: unknown): boolean {
  return parseHttpUrl(value) !== null;
}

function isAllowedHost(value: unknown, allowedHosts: string[]): boolean {
  const parsed = parseHttpUrl(value);
  return parsed !== null && allowedHosts.includes(parsed.hostname);
}

function generateSessionNonce(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

const MAX_ERROR_RETRIES = 3;

function App(): React.JSX.Element {
  const mainWebViewRef = useRef<WebView>(null);
  // ── Display ads (max 3) — no native queue ───────────────────────────
  // The web layer (Zustand ad-store) owns the queue. Native is a pure
  // renderer: it displays whatever OPEN_AD / SYNC_ADS tells it to.
  const [displayAds, setDisplayAds] = useState<AdInfo[]>([]);
  // Per-ad version counter → only recreate a WebView when its URL changes
  const [adVersions, setAdVersions] = useState<Record<string, number>>({});
  const [updateInfo, setUpdateInfo] = useState<{ isRequired: boolean; url: string; notes: string } | null>(null);
  const [webUrl, setWebUrl] = useState<string>(DEFAULT_WEB_URL);
  const [configError, setConfigError] = useState<boolean>(false);
  const [networkError, setNetworkError] = useState<boolean>(false);
  const [webViewLoading, setWebViewLoading] = useState<boolean>(true);
  const retryCountRef = useRef<number>(0);
  const [isInPiP, setIsInPiP] = useState<boolean>(false);

  useEffect(() => {
    if (webViewLoading) {
      const timer = setTimeout(() => setWebViewLoading(false), 6000);
      return () => clearTimeout(timer);
    }
  }, [webViewLoading]);

  const sessionNonceRef = useRef<string>('');
  if (!sessionNonceRef.current) {
    sessionNonceRef.current = generateSessionNonce();
  }

  // ── Refs ──────────────────────────────────────────────────────────────
  const displayAdsRef = useRef<AdInfo[]>([]);
  const appStateRef = useRef<string>(AppState.currentState);
  const autoLikeActiveRef = useRef<boolean>(false);
  const adVersionsRef = useRef<Record<string, number>>({});
  /** Ads whose native timer has expired and were visually removed. SYNC_ADS
   *  must not re-add them (web still has them in active until its own timer
   *  fires, which may be delayed in background/PiP). */
  const visuallyDismissedRef = useRef<Set<string>>(new Set());

  useEffect(() => { displayAdsRef.current = displayAds; }, [displayAds]);
  useEffect(() => { adVersionsRef.current = adVersions; }, [adVersions]);

  const networkErrorRef = useRef<boolean>(networkError);
  useEffect(() => { networkErrorRef.current = networkError; }, [networkError]);

  const bumpAdVersion = useCallback((linkId: string) => {
    setAdVersions((prev) => {
      const next = { ...prev, [linkId]: (prev[linkId] ?? 0) + 1 };
      adVersionsRef.current = next;
      return next;
    });
  }, []);

  // ── Config ────────────────────────────────────────────────────────────
  const fetchConfig = async () => {
    try {
      const res = await fetch(`${CONFIG_URL}?t=${Date.now()}`);
      if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
      const data = await res.json();
      if (data.latestVersion !== APP_VERSION && data.forceUpdate) {
        const safeDownloadUrl = isAllowedHost(data.downloadUrl, ALLOWED_DOWNLOAD_HOSTS)
          ? data.downloadUrl : DEFAULT_DOWNLOAD_URL;
        if (safeDownloadUrl !== data.downloadUrl) {
          console.log('Rejected untrusted downloadUrl:', data.downloadUrl);
        }
        setUpdateInfo({ isRequired: true, url: safeDownloadUrl, notes: data.releaseNotes });
      }
      if (data.webUrl && data.webUrl !== DEFAULT_WEB_URL) {
        if (isAllowedHost(data.webUrl, ALLOWED_WEB_HOSTS)) {
          setWebUrl(data.webUrl);
        } else {
          console.log('Rejected untrusted webUrl:', data.webUrl);
        }
      }
    } catch (err) {
      console.log('Config check failed', err);
    }
  };

  function getProxiedAdUrl(adUrl: string): string {
    return adUrl;
  }

  // ── Bridge dispatch ───────────────────────────────────────────────────
  const dispatchToWeb = useCallback((payload: Record<string, unknown>) => {
    if (!mainWebViewRef.current) return;
    const serialized = JSON.stringify(
      JSON.stringify({ ...payload, nonce: sessionNonceRef.current })
    );
    mainWebViewRef.current.injectJavaScript(`
      (function() {
        var data = ${serialized};
        var event;
        try {
          event = new MessageEvent('message', { data: data });
        } catch (e) {
          event = document.createEvent('MessageEvent');
          event.initMessageEvent('message', true, true, data, '*', '', window);
        }
        window.dispatchEvent(event);
      })();
      true;
    `);
  }, []);

  // ── Remove an ad from display (manual X tap or CLOSE_AD from web) ────
  const removeAd = useCallback((linkId: string) => {
    const current = displayAdsRef.current;
    const next = current.filter((a) => a.linkId !== linkId);
    if (next.length !== current.length) {
      setDisplayAds(next);
      visuallyDismissedRef.current.delete(linkId);
      setAdVersions((prev) => {
        const nextVersions = { ...prev };
        delete nextVersions[linkId];
        return nextVersions;
      });
    }
  }, []);

  // ── Native-side visual timer (14 s cycle) ─────────────────────────────
  // The commit is handled by the web layer's setTimeout / safety-net.
  // Native handles visual cycling so PiP users see fresh ads on time.
  // When a slot's time is up we send AD_DISMISSED to web so it can
  // reconcile immediately instead of waiting for its own timer.
  useEffect(() => {
    let cleanupSweepCounter = 0;
    const interval = setInterval(() => {
      const now = Date.now();
      const display = displayAdsRef.current;
      let changed = false;
      let next = display;
      const dismissedIds: string[] = [];

      for (const ad of display) {
        if (ad.startedAt > 0 && now - ad.startedAt >= TOTAL_AD_MS) {
          next = next.filter((a) => a.linkId !== ad.linkId);
          visuallyDismissedRef.current.add(ad.linkId);
          dismissedIds.push(ad.linkId);
          changed = true;
        }
      }

      if (changed) {
        setDisplayAds(next);
        const removed = display.filter((ad) => !next.some((a) => a.linkId === ad.linkId));
        setAdVersions((prev) => {
          const nv = { ...prev };
          for (const ad of removed) delete nv[ad.linkId];
          return nv;
        });
        // Notify web so it can clean up its active list promptly.
        // reason: 'expired' tells web this ad was fully watched (natural
        // 14s timeout) so it must still be committed, not silently discarded.
        for (const id of dismissedIds) {
          dispatchToWeb({ type: 'AD_DISMISSED', linkId: id, reason: 'expired' });
        }
      }

      // Periodic cleanup: sweep visuallyDismissedRef for entries whose ads
      // are no longer in the web's active list (confirmed resolved).
      cleanupSweepCounter++;
      if (cleanupSweepCounter >= 30) {
        cleanupSweepCounter = 0;
        const currentIds = new Set(displayAdsRef.current.map((a) => a.linkId));
        for (const id of visuallyDismissedRef.current) {
          if (!currentIds.has(id)) {
            visuallyDismissedRef.current.delete(id);
          }
        }
      }
    }, TIMER_TICK_MS);
    return () => clearInterval(interval);
  }, [dispatchToWeb]);

  // ── PiP + network + app state ─────────────────────────────────────────
  useEffect(() => {
    fetchConfig();

    const appStateSub = AppState.addEventListener('change', (nextAppState) => {
      const prev = appStateRef.current;
      appStateRef.current = nextAppState;
      if (nextAppState === 'active' && prev !== 'active') {
        dispatchToWeb({ type: 'HEARTBEAT' });
      }
    });

    let prevConnected: boolean | null = null;
    const netInfoSub = NetInfo.addEventListener((state) => {
      if (state.isConnected === prevConnected) return;
      prevConnected = state.isConnected;
      if (state.isConnected === false) {
        setNetworkError(true);
      } else if (state.isConnected === true && networkErrorRef.current) {
        setNetworkError(false);
        retryCountRef.current = 0;
        setWebViewLoading(true);
        setTimeout(() => { mainWebViewRef.current?.reload(); }, 500);
      }
    });

    return () => { appStateSub.remove(); netInfoSub(); };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'android') {
      const sub = DeviceEventEmitter.addListener('onPiPModeChanged', (event: any) => {
        setIsInPiP(event.isInPiP === true);
        dispatchToWeb({ type: 'HEARTBEAT' });
      });
      return () => sub.remove();
    }
  }, []);

  // PiP gate: only enable when auto-like is actually running. Ads shown from
  // a manual "Like" tap must NOT trigger PiP on their own — PiP is reserved
  // for the "auto-like on, app backgrounded" flow.
  useEffect(() => {
    if (Platform.OS === 'android' && NativeModules.PipModule) {
      const enable = autoLikeActiveRef.current === true;
      try { NativeModules.PipModule.setPiPEnabled(enable); } catch (e) { console.error('[PiP] setPiPEnabled failed:', e); }
    }
  }, [displayAds]);

  // Background heartbeat: keep web WebView timers alive
  useEffect(() => {
    const interval = setInterval(() => {
      if (appStateRef.current === 'background' || appStateRef.current === 'inactive') {
        dispatchToWeb({ type: 'HEARTBEAT' });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [dispatchToWeb]);

  // ── WebView error / retry ─────────────────────────────────────────────
  const handleQuit = () => {
    if (Platform.OS === 'android') BackHandler.exitApp();
  };

  const handleRetry = async () => {
    setNetworkError(false);
    setWebViewLoading(true);
    retryCountRef.current = 0;
    await fetchConfig();
    mainWebViewRef.current?.reload();
  };

  const handleWebViewError = useCallback(async () => {
    const state = await NetInfo.fetch();
    if (state.isConnected === false) { setNetworkError(true); return; }
    retryCountRef.current++;
    if (retryCountRef.current >= MAX_ERROR_RETRIES) { setNetworkError(true); return; }
    const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 8000);
    setTimeout(() => {
      if (mainWebViewRef.current) { setWebViewLoading(true); mainWebViewRef.current.reload(); }
    }, delay);
  }, []);

  // ── Main message handler ──────────────────────────────────────────────
  const onMainMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);

      if (data.type === 'OPEN_AD') {
        if (typeof data.linkId !== 'string' || !data.linkId || !isHttpUrl(data.url)) return;

        dispatchToWeb({ type: 'BRIDGE_INIT' }); // ensure nonce

        const current = displayAdsRef.current;
        // Use web-provided startedAt so both layers measure from the same
        // wall-clock moment.  Fallback to Date.now() for older web builds.
        const adStartedAt = typeof data.startedAt === 'number' && data.startedAt > 0
          ? data.startedAt
          : Date.now();

        // Already showing this ad?
        const existing = current.find((a) => a.linkId === data.linkId);
        if (existing) {
          if (existing.url === data.url) return; // duplicate
          // URL changed — update in place
          setDisplayAds(current.map((a) =>
            a.linkId === data.linkId ? { ...a, url: data.url, startedAt: adStartedAt, loadedAt: undefined } : a
          ));
          bumpAdVersion(data.linkId);
          visuallyDismissedRef.current.delete(data.linkId);
          return;
        }

        // Display full?  Check if any slot has an ad past its time — replace
        // the oldest overdue one instead of silently dropping.
        if (current.length >= MAX_DISPLAY_ADS) {
          const now = Date.now();
          const overdueIdx = current.findIndex(
            (a) => a.startedAt > 0 && (now - a.startedAt) >= (TOTAL_AD_MS + DISPLAY_FULL_GRACE_MS)
          );
          if (overdueIdx >= 0) {
            const replaced = current[overdueIdx];
            // This slot was already past its 14s window — same as a natural
            // expiry, so it must be committed, not just dismissed.
            dispatchToWeb({ type: 'AD_DISMISSED', linkId: replaced.linkId, reason: 'expired' });
            visuallyDismissedRef.current.add(replaced.linkId);
            const next = [...current];
            next[overdueIdx] = { url: data.url, linkId: data.linkId, startedAt: adStartedAt, loadedAt: undefined };
            setDisplayAds(next);
            bumpAdVersion(data.linkId);
            visuallyDismissedRef.current.delete(data.linkId);
            return;
          }
          // All slots still within time — defer to web queue (SYNC_ADS will
          // re-send when a slot frees).
          console.log('[OPEN_AD] Display full, deferring to web queue:', data.linkId);
          return;
        }

        const newAd: AdInfo = { url: data.url, linkId: data.linkId, startedAt: adStartedAt, loadedAt: undefined };
        setDisplayAds([...current, newAd]);
        bumpAdVersion(data.linkId);
        visuallyDismissedRef.current.delete(data.linkId);

      } else if (data.type === 'SYNC_AUTO_LIKE_STATUS') {
        autoLikeActiveRef.current = data.active === true;
        if (Platform.OS === 'android' && NativeModules.PipModule) {
          try {
            NativeModules.PipModule.setAutoLikeActive(autoLikeActiveRef.current);
            NativeModules.PipModule.setPiPEnabled(autoLikeActiveRef.current);
          } catch (e) { console.error('[SYNC_AUTO_LIKE] PipModule call failed:', e); }
        }

      } else if (data.type === 'CLOSE_AD') {
        // Web confirms ad removal — clean up display
        removeAd(data.linkId);

      } else if (data.type === 'SYNC_ADS') {
        // Full ad-state sync from web HEARTBEAT.
        const incoming = (data.ads || []) as AdInfo[];
        const valid = incoming.filter(
          (a: any) => typeof a?.linkId === 'string' && a.linkId.length > 0 && isHttpUrl(a?.url)
        );
        // Filter out ads the native timer has already visually dismissed
        const filtered = valid.filter(
          (a: AdInfo) => !visuallyDismissedRef.current.has(a.linkId)
        );
        const unique = filtered.filter(
          (ad, i, list) => list.findIndex((x) => x.linkId === ad.linkId) === i
        );

        // Take first 3 only (web layer sends max 3 active ads)
        const incomingIds = new Set(unique.map((a: AdInfo) => a.linkId));
        const now = Date.now();
        const current = displayAdsRef.current;

        // Preserve startedAt/loadedAt for ads already showing
        const next: AdInfo[] = unique.slice(0, MAX_DISPLAY_ADS).map((incomingAd) => {
          const existing = current.find((a) => a.linkId === incomingAd.linkId);
          if (existing) return { ...incomingAd, startedAt: existing.startedAt, loadedAt: existing.loadedAt };
          return { ...incomingAd, startedAt: now, loadedAt: undefined };
        });

        const changed = next.length !== current.length ||
          next.some((ad, i) => ad.linkId !== current[i]?.linkId || ad.url !== current[i]?.url);

        if (changed) {
          setDisplayAds(next);
          for (const ad of next) {
            const existing = current.find((a) => a.linkId === ad.linkId);
            if (!existing || existing.url !== ad.url) bumpAdVersion(ad.linkId);
          }
        }

        // Notify web about ads that were in display but not in incoming
        const removed = current.filter((ad) => !incomingIds.has(ad.linkId));
        for (const ad of removed) {
          dispatchToWeb({ type: 'AD_DISMISSED', linkId: ad.linkId });
          visuallyDismissedRef.current.delete(ad.linkId);
        }

      } else if (data.type === 'CLEAR_CACHE') {
        setDisplayAds([]);
        setAdVersions({});
        visuallyDismissedRef.current = new Set();
        mainWebViewRef.current?.clearCache(true);
        mainWebViewRef.current?.clearHistory?.();
        mainWebViewRef.current?.reload();
      }
    } catch (e) { /* invalid JSON */ }
  };

  // ── Render single ad WebView ──────────────────────────────────────────
  const renderAdWebView = (ad: AdInfo | null) => {
    if (!ad) return null;
    const version = adVersions[ad.linkId] ?? 0;
    const elapsedSec = ad.startedAt > 0 ? Math.floor((Date.now() - ad.startedAt) / 1000) : 0;
    const isLoading = ad.startedAt > 0 && !ad.loadedAt && elapsedSec < 4;

    return (
      <WebViewComponent
        key={`${ad.linkId}:${version}`}
        source={{ uri: getProxiedAdUrl(ad.url) }}
        style={styles.floatingWebView}
        onLoadEnd={() => {
          if (ad) {
            setDisplayAds((prev) =>
              prev.map((a) => (a.linkId === ad.linkId ? { ...a, loadedAt: Date.now() } : a))
            );
            dispatchToWeb({ type: 'AD_LOADED', linkId: ad.linkId });
          }
        }}
        onError={(e: any) => console.log('Ad WebView error:', e.nativeEvent)}
        onHttpError={(e: any) => console.log('Ad WebView HTTP error:', e.nativeEvent.statusCode)}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
        userAgent="Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36"
        injectedJavaScriptBeforeContentLoaded={`
          (function(){
            window.alert = function(){};
            window.confirm = function(){ return false; };
            window.prompt = function(){ return null; };
          })();
          true;
        `}
        injectedJavaScript={`
          (function(){
            window.alert = function(){};
            window.confirm = function(){ return false; };
            window.prompt = function(){ return null; };
            var muteAll=function(){
              var v=document.getElementsByTagName('video');
              for(var i=0;i<v.length;i++){v[i].muted=true;v[i].volume=0;}
              var a=document.getElementsByTagName('audio');
              for(var i=0;i<a.length;i++){a[i].muted=true;a[i].volume=0;}
            };
            muteAll();setInterval(muteAll,1000);
            document.addEventListener('click',function(e){
              var t=e.target;
              while(t&&t.tagName!=='A')t=t.parentNode;
              if(t){
                var h=(t.href||'').toLowerCase();
                if(t.hasAttribute('download')||h.includes('.apk')||h.startsWith('blob:')){
                  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
                }
              }
            },true);
          })();
          true;
        `}
        onShouldStartLoadWithRequest={(req: any) => {
          const u = req.url;
          if (!u || u === 'about:blank') return true;
          if (!u.startsWith('http://') && !u.startsWith('https://')) return false;
          const lower = u.toLowerCase();
          if (lower.includes('play.google.com') || lower.includes('market://') || lower.includes('intent://') || lower.includes('.apk') || lower.includes('download=') || lower.includes('force-download') || lower.includes('redirect=') || lower.includes('redirect_url=')) return false;
          return true;
        }}
        setSupportMultipleWindows={false}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={true}
        cacheEnabled={false}
        androidLayerType="hardware"
      />
    );
  };

  // ── Render ────────────────────────────────────────────────────────────
  const hasAds = displayAds.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" hidden={isInPiP} />
      <View style={[styles.innerContainer, { paddingTop: Platform.OS === 'android' && !isInPiP ? (StatusBar.currentHeight ?? 24) : 0 }]}>
        <View style={[styles.mainWebViewContainer, isInPiP && styles.hiddenMainWebView]}>
          <WebViewComponent
            ref={mainWebViewRef}
            source={{ uri: webUrl }}
            style={styles.mainWebView}
            onMessage={onMainMessage}
            onLoadStart={() => setWebViewLoading(true)}
            onLoad={() => setWebViewLoading(false)}
            onLoadEnd={() => {
              setWebViewLoading(false);
              setNetworkError(false);
              retryCountRef.current = 0;
              dispatchToWeb({ type: 'BRIDGE_INIT' });
            }}
            onLoadProgress={(e: any) => {
              if (typeof e?.nativeEvent?.progress === 'number' && e.nativeEvent.progress > 0.75) {
                setWebViewLoading(false);
              }
            }}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            cacheEnabled={true}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            injectedJavaScript={`
              (function(){
                try{
                  var ctx=new (window.AudioContext||window.webkitAudioContext)();
                  var o=ctx.createOscillator();
                  var g=ctx.createGain();g.gain.value=0.0001;
                  o.connect(g);g.connect(ctx.destination);o.start();
                }catch(e){}
              })();
              true;
            `}
            androidLayerType="hardware"
            onShouldStartLoadWithRequest={(req: any) => {
              const u = req.url;
              if (!u) return true;
              return isAllowedHost(u, ALLOWED_WEB_HOSTS) || u.startsWith('about:');
            }}
            onError={() => handleWebViewError()}
            onHttpError={(e: any) => {
              if (typeof e?.nativeEvent?.statusCode === 'number' && e.nativeEvent.statusCode >= 500) {
                handleWebViewError();
              }
            }}
          />
        </View>

        {webViewLoading && !isInPiP && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#a855f7" />
            <Text style={styles.loadingText}>Smart Dream...</Text>
          </View>
        )}

        <View style={[styles.adsWrapper, !hasAds && { display: 'none' }, isInPiP && styles.pipAdsWrapper]}>
          <ScrollView
            horizontal={!isInPiP}
            scrollEnabled={!isInPiP}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={isInPiP ? styles.pipAdsRow : styles.scrollContent}
            bounces={false}
            overScrollMode="never"
          >
            {[0, 1, 2].map((index) => {
              const ad = displayAds[index] || null;
              const elapsedSec = ad && ad.startedAt > 0 ? Math.floor((Date.now() - ad.startedAt) / 1000) : 0;
              const isLoadingPhase = ad && ad.startedAt > 0 && !ad.loadedAt && elapsedSec < 4;

              return (
                <View
                  key={ad ? `${ad.linkId}:${adVersions[ad.linkId] ?? 0}` : `empty-slot-${index}`}
                  style={[styles.floatingAdContainer, !ad && { display: 'none' }, isInPiP && styles.pipAdSlot]}
                >
                  {!isInPiP && (
                    <View style={styles.adHeader}>
                      <Text style={styles.adTitle}>
                        {ad ? (isLoadingPhase ? 'Loading ad...' : 'Ad is active') : 'Ad is active'}
                      </Text>
                      <TouchableOpacity onPress={() => {
                        if (ad) {
                          dispatchToWeb({ type: 'AD_DISMISSED', linkId: ad.linkId });
                          removeAd(ad.linkId);
                        }
                      }} style={styles.closeBtn}>
                        <Text style={styles.closeBtnText}>X</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {isInPiP && ad && (
                    <View style={styles.pipLabel}>
                      <Text style={styles.pipLabelText}>{isLoadingPhase ? 'Loading...' : 'Viewing...'}</Text>
                    </View>
                  )}
                  {renderAdWebView(ad)}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>

      {updateInfo?.isRequired && (
        <Modal visible={true} transparent animationType="fade">
          <View style={styles.updateOverlay}>
            <View style={styles.updateModal}>
              <Text style={styles.updateTitle}>Update Required</Text>
              <Text style={styles.updateNotes}>{updateInfo.notes}</Text>
              <TouchableOpacity style={styles.updateButton} onPress={() => { if (updateInfo.url) Linking.openURL(updateInfo.url); }}>
                <Text style={styles.updateButtonText}>Update Now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      <Modal visible={networkError} transparent animationType="fade">
        <View style={styles.errorOverlay}>
          <View style={styles.errorModal}>
            <View style={styles.errorIconContainer}><Text style={styles.errorIcon}>📶</Text></View>
            <Text style={styles.errorTitle}>Internet Connection Lost</Text>
            <Text style={styles.errorSubtitle}>আপনার ইন্টারনেট সংযোগ বিচ্ছিন্ন হয়ে গেছে। অনুগ্রহ করে কানেকশন চেক করে আবার চেষ্টা করুন।</Text>
            <View style={styles.errorButtonGroup}>
              <TouchableOpacity style={[styles.errorButton, styles.retryButton]} onPress={handleRetry}>
                <Text style={styles.retryButtonText}>Retry (আবার চেষ্টা করুন)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.errorButton, styles.quitButton]} onPress={handleQuit}>
                <Text style={styles.quitButtonText}>Quit (বন্ধ করুন)</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  pipAdsWrapper: {
    position: 'relative', flex: 1, height: '100%', width: '100%',
    backgroundColor: '#000', padding: 2, paddingVertical: 2, paddingBottom: 2,
    bottom: undefined, left: undefined, right: undefined, zIndex: 20,
  },
  pipAdsRow: { flexDirection: 'row', width: '100%', height: '100%', gap: 2 },
  pipAdSlot: {
    flex: 1, height: '100%', backgroundColor: '#1e1e1e',
    borderRadius: 4, overflow: 'hidden', borderColor: '#333', borderWidth: 0.5,
  },
  pipLabel: {
    position: 'absolute', top: 4, left: 4, zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  pipLabelText: { color: '#fff', fontSize: 8, fontWeight: 'bold' },
  mainWebViewContainer: { flex: 1 },
  hiddenMainWebView: { position: 'absolute', width: 1, height: 1, opacity: 0.01, overflow: 'hidden' },
  innerContainer: { flex: 1, backgroundColor: '#000' },
  mainWebView: { flex: 1, backgroundColor: 'transparent' },
  loadingContainer: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    justifyContent: 'center', alignItems: 'center', backgroundColor: '#09090b',
  },
  loadingText: { color: '#a855f7', marginTop: 12, fontSize: 16, fontWeight: 'bold' },
  adsWrapper: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 180,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingVertical: 10,
    paddingBottom: Platform.OS === 'android' ? 24 : 10, zIndex: 20,
  },
  scrollContent: { paddingHorizontal: 10 },
  floatingAdContainer: {
    width: 110, height: 160, backgroundColor: '#1e1e1e',
    borderRadius: 8, overflow: 'hidden', borderColor: '#444', borderWidth: 1, marginRight: 10,
  },
  adHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#2c2c2c', paddingHorizontal: 10, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: '#444',
  },
  adTitle: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  closeBtn: { backgroundColor: '#555', width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  floatingWebView: { flex: 1, backgroundColor: '#000' },
  updateOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  updateModal: { width: '100%', backgroundColor: '#1e1e1e', borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#444' },
  updateTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 12 },
  updateNotes: { fontSize: 14, color: '#aaa', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  updateButton: { backgroundColor: '#a855f7', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 30, width: '100%', alignItems: 'center' },
  updateButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  errorOverlay: { flex: 1, backgroundColor: 'rgba(9,9,11,0.95)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorModal: {
    width: '100%', maxWidth: 340, backgroundColor: '#18181b', borderRadius: 24, padding: 30,
    alignItems: 'center', borderWidth: 1, borderColor: 'rgba(168,85,247,0.2)',
    shadowColor: '#a855f7', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8,
  },
  errorIconContainer: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(168,85,247,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: 'rgba(168,85,247,0.3)' },
  errorIcon: { fontSize: 28, color: '#a855f7' },
  errorTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 10, textAlign: 'center' },
  errorSubtitle: { fontSize: 14, color: '#a1a1aa', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  errorButtonGroup: { width: '100%', gap: 12 },
  errorButton: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', width: '100%' },
  retryButton: { backgroundColor: '#a855f7' },
  retryButtonText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  quitButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  quitButtonText: { color: '#d4d4d8', fontSize: 15, fontWeight: '600' },
});

export default App;
