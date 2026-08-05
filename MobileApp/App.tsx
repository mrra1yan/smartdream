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
// Matches src/app/api/app-version/route.ts's own default downloadUrl -- the
// known-good fallback if remote config ever hands us an untrusted one.
const DEFAULT_DOWNLOAD_URL = 'https://github.com/nurulhudda247/SmartDream-Releases/releases/latest/download/SmartDream.apk';

// Hosts we trust for the main WebView's `source`. Remote config (`webUrl`)
// only gets used if it resolves to one of these -- otherwise a compromised
// or MITM'd config.json could redirect the whole app (with its
// sharedCookiesEnabled session) to an attacker-controlled origin.
// Mirrors the deploy targets this app actually serves from, per
// next.config.ts's serverActions.allowedOrigins plus the hardcoded default
// below.
const ALLOWED_WEB_HOSTS = [
  'sd.docstec.cloud',
];

// Host we trust for the forced-update download link. Releases are published
// to GitHub Releases (see src/app/api/app-version/route.ts's default
// downloadUrl) -- never hand Linking.openURL a value pointing anywhere else.
const ALLOWED_DOWNLOAD_HOSTS = ['github.com'];

type AdInfo = {
  url: string;
  linkId: string;
};

/**
 * Parses `value` as an absolute http(s) URL, or returns null. Used both as a
 * standalone scheme check (ad URLs) and as the basis for the host-allowlist
 * check below -- centralizing it means every caller gets the same "must be
 * http/https, never javascript:/file:/intent:/etc." guarantee.
 */
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

/**
 * Generates a per-session nonce the web layer must echo back on every
 * native->web bridge message (see dispatchToWeb). This RN version doesn't
 * ship a `crypto` global (no react-native-get-random-values / expo-crypto
 * installed, confirmed by inspecting node_modules), so prefer
 * crypto.randomUUID() when available and fall back to a
 * Math.random()+Date.now() combo otherwise. This only needs to be
 * unguessable by arbitrary page content, not cryptographically bulletproof.
 */
function generateSessionNonce(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

// Maximum consecutive WebView error retries before showing the error modal.
// Prevents infinite reload loops when the server is genuinely down.
const MAX_ERROR_RETRIES = 3;

function App(): React.JSX.Element {
  const mainWebViewRef = useRef<WebView>(null);
  const [ads, setAds] = useState<AdInfo[]>([]);
  const [adRefreshEpoch, setAdRefreshEpoch] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<{ isRequired: boolean; url: string; notes: string } | null>(null);
  const [webUrl, setWebUrl] = useState<string>(DEFAULT_WEB_URL);
  const [configError, setConfigError] = useState<boolean>(false);
  const [networkError, setNetworkError] = useState<boolean>(false);
  const [webViewLoading, setWebViewLoading] = useState<boolean>(true);
  const retryCountRef = useRef<number>(0);
  const [isInPiP, setIsInPiP] = useState<boolean>(false);

  // ── Safety timeout for loading spinner ──────────────────────────────
  // Guarantees the loading spinner disappears after 6 seconds even if
  // slow dynamic third-party ad iframes/scripts keep loading in the background.
  useEffect(() => {
    if (webViewLoading) {
      const timer = setTimeout(() => {
        setWebViewLoading(false);
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [webViewLoading]);

  // One nonce per app session, shared with the web layer via BRIDGE_INIT and
  // echoed on every subsequent native->web message so the web layer can
  // reject forged AD_LOADED/AD_DISMISSED messages that didn't actually come
  // from us (see dispatchToWeb + src/components/ad-container.tsx).
  const sessionNonceRef = useRef<string>('');
  if (!sessionNonceRef.current) {
    sessionNonceRef.current = generateSessionNonce();
  }

  const fetchConfig = async () => {
    try {
      // added cache buster to prevent cached config
      const res = await fetch(`${CONFIG_URL}?t=${Date.now()}`);
      if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
      const data = await res.json();

      // String compare versions. If API version doesn't match and forceUpdate is true, block app
      if (data.latestVersion !== APP_VERSION && data.forceUpdate) {
        const safeDownloadUrl = isAllowedHost(data.downloadUrl, ALLOWED_DOWNLOAD_HOSTS)
          ? data.downloadUrl
          : DEFAULT_DOWNLOAD_URL;
        if (safeDownloadUrl !== data.downloadUrl) {
          console.log('Rejected untrusted downloadUrl from remote config:', data.downloadUrl);
        }
        setUpdateInfo({
          isRequired: true,
          url: safeDownloadUrl,
          notes: data.releaseNotes,
        });
      }

      if (data.webUrl && data.webUrl !== DEFAULT_WEB_URL) {
        if (isAllowedHost(data.webUrl, ALLOWED_WEB_HOSTS)) {
          setWebUrl(data.webUrl);
        } else {
          console.log('Rejected untrusted webUrl from remote config:', data.webUrl);
        }
      }
    } catch (err) {
      console.log('Config check failed', err);
      // If config fails and we have no cached or loaded state, we might let webview try.
    }
  };

  const adsRef = useRef<AdInfo[]>([]);
  const appStateRef = useRef<string>(AppState.currentState);
  const autoLikeActiveRef = useRef<boolean>(false);
  const adRefreshEpochRef = useRef(0);

  useEffect(() => { adsRef.current = ads; }, [ads]);

  const updateAds = (nextAds: AdInfo[]) => {
    adsRef.current = nextAds;
    setAds(nextAds);
  };

  const refreshAdWebViews = () => {
    adRefreshEpochRef.current += 1;
    setAdRefreshEpoch(adRefreshEpochRef.current);
  };

	  // ── Load ad URLs directly (no proxy) ─────────────────────────────
	  // Previously routed through /api/embed-frame proxy for header
	  // enrichment, but Adsterra detects datacenter IPs (Vercel) and
	  // returns blank pages. Loading directly uses the device's own IP.
	  function getProxiedAdUrl(adUrl: string): string {
	    return adUrl;
	  }

  const networkErrorRef = useRef<boolean>(networkError);
  useEffect(() => {
    networkErrorRef.current = networkError;
  }, [networkError]);

  useEffect(() => {
    fetchConfig();

    // ── Track app state for HEARTBEAT throttling ──────────────────────
    // The HEARTBEAT interval only fires when the app is backgrounded so
    // we don't waste CPU pinging the WebView while the user is active.
    const appStateSub = AppState.addEventListener('change', (nextAppState) => {
      const previousAppState = appStateRef.current;
      appStateRef.current = nextAppState;
      if (nextAppState === 'active' && previousAppState !== 'active') {
        refreshAdWebViews();
        dispatchToWeb({ type: 'HEARTBEAT' });
      }
    });

    // ── Proactive network monitoring ──────────────────────────────────
    // Auto-show the error when the device genuinely goes offline, and
    // auto-recover (dismiss error + reload) when connectivity returns.
    // Replaces the old "user must tap Retry" flow for network recovery.
    let prevConnected: boolean | null = null;
    const netInfoSub = NetInfo.addEventListener((state) => {
      // NetInfo can emit multiple events with the same or null status.
      // We only react when there is an actual change in the connection state.
      if (state.isConnected === prevConnected) return;
      prevConnected = state.isConnected;

      if (state.isConnected === false) {
        setNetworkError(true);
      } else if (state.isConnected === true) {
        // Network returned — auto-recover if the error modal is showing
        if (networkErrorRef.current) {
          setNetworkError(false);
          retryCountRef.current = 0;
          setWebViewLoading(true);
          setTimeout(() => {
            if (mainWebViewRef.current) {
              mainWebViewRef.current.reload();
            }
          }, 500);
        }
      }
    });

    return () => {
      appStateSub.remove();
      netInfoSub();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'android') {
      const subscription = DeviceEventEmitter.addListener('onPiPModeChanged', (event: any) => {
        setIsInPiP(event.isInPiP === true);
        refreshAdWebViews();
        dispatchToWeb({ type: 'HEARTBEAT' });
      });
      return () => {
        subscription.remove();
      };
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'android' && NativeModules.PipModule) {
      try {
        NativeModules.PipModule.setPiPEnabled(ads.length > 0);
      } catch (e) {
        console.log('Error setting PiP enabled:', e);
      }
    }
  }, [ads]);

  useEffect(() => {
    // Keep WebView timers alive in the background.
    // By pinging the WebView every second, we give Chromium a chance
    // to process its JS task queue while the app is backgrounded.
    const interval = setInterval(() => {
      if (appStateRef.current === 'background' || appStateRef.current === 'inactive') {
        dispatchToWeb({ type: 'HEARTBEAT' });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleQuit = () => {
    if (Platform.OS === 'android') {
      BackHandler.exitApp();
    } else {
      try {
        // @ts-ignore
        if (global && typeof global.close === 'function') {
          // @ts-ignore
          global.close();
        } else {
          // @ts-ignore
          exit(0);
        }
      } catch (e) {
        console.log('Exit failed', e);
      }
    }
  };

  const handleRetry = async () => {
    setNetworkError(false);
    setWebViewLoading(true);
    retryCountRef.current = 0;
    await fetchConfig();
    if (mainWebViewRef.current) {
      mainWebViewRef.current.reload();
    }
  };

  // ── Connectivity-gated error handler ──────────────────────────────────
  // Instead of blindly showing the error modal on any WebView error, check
  // if the device actually has internet. If connected, auto-retry with
  // exponential backoff. Only show the error after MAX_ERROR_RETRIES or
  // when the device is genuinely offline.
  const handleWebViewError = useCallback(async () => {
    const state = await NetInfo.fetch();
    if (state.isConnected === false) {
      // Device is genuinely offline → show error immediately
      setNetworkError(true);
      return;
    }
    // Device is connected — this was a transient error (Vercel cold start,
    // SSL hiccup, 502, etc.). Auto-retry with backoff.
    retryCountRef.current++;
    if (retryCountRef.current >= MAX_ERROR_RETRIES) {
      // Too many consecutive failures even with connectivity — give up
      setNetworkError(true);
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 8000);
    setTimeout(() => {
      if (mainWebViewRef.current) {
        setWebViewLoading(true);
        mainWebViewRef.current.reload();
      }
    }, delay);
  }, []);

  // Builds a `window.dispatchEvent(new MessageEvent(...))` call and runs it
  // in the main WebView via injectJavaScript. `payload` is JSON.stringify'd
  // here (real JS, not string-interpolated into the template) and then
  // JSON.stringify'd again to embed it as a correctly-escaped JS string
  // literal -- this is what actually neutralizes quotes/backslashes in any
  // interpolated value, unlike the previous manual `'${linkId}'` wrapping.
  // Every message also carries the session nonce so the web layer can tell
  // this came from native and not from some arbitrary postMessage call.
  const dispatchToWeb = (payload: Record<string, unknown>) => {
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
  };

  const onMainMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'OPEN_AD') {
        if (typeof data.linkId !== 'string' || data.linkId.length === 0 || !isHttpUrl(data.url)) {
          console.log('Rejected OPEN_AD with invalid linkId or URL:', data.linkId, data.url);
          return;
        }
        // Resend BRIDGE_INIT (same nonce -- idempotent, the web side just
        // overwrites nativeBridgeNonce with the same value) alongside every
        // OPEN_AD, not just once at main-webview load. Closes the race
        // where AdContainer's message listener hasn't registered yet at the
        // moment the original load-time BRIDGE_INIT fired, which would
        // otherwise leave nativeBridgeNonce null for the rest of the
        // session and cause every AD_LOADED/AD_DISMISSED to be silently
        // dropped by the strict nonce check. Every AD_DISMISSED necessarily
        // comes after an OPEN_AD for the same ad, so this ordering
        // guarantees the nonce is set before any dismissal can arrive.
        dispatchToWeb({ type: 'BRIDGE_INIT' });
        const current = adsRef.current;
        const existing = current.find((ad) => ad.linkId === data.linkId);
        if (existing?.url === data.url) return;

        if (existing) {
          updateAds(current.map((ad) =>
            ad.linkId === data.linkId ? { url: data.url, linkId: data.linkId } : ad,
          ));
          refreshAdWebViews();
          return;
        }

        const nextAds = [...current, { url: data.url, linkId: data.linkId }];
        const evicted = nextAds.length > 3 ? nextAds.slice(0, nextAds.length - 3) : [];
        updateAds(nextAds.slice(-3));
        refreshAdWebViews();
        evicted.forEach((ad) => dispatchToWeb({ type: 'AD_DISMISSED', linkId: ad.linkId }));
      } else if (data.type === 'SYNC_AUTO_LIKE_STATUS') {
        autoLikeActiveRef.current = data.active === true;
      } else if (data.type === 'CLOSE_AD') {
        const currentAd = adsRef.current.find((a) => a.linkId === data.linkId);
        if (currentAd && typeof data.url === 'string' && currentAd.url !== data.url) return;
        const nextAds = adsRef.current.filter((a) => a.linkId !== data.linkId);
        if (nextAds.length !== adsRef.current.length) {
          updateAds(nextAds);
          refreshAdWebViews();
        }
      } else if (data.type === 'SYNC_ADS') {
        // ── Full ad-state sync from the web layer's HEARTBEAT handler.
        //     When Chromium throttles React re-renders in the background,
        //     the normal OPEN_AD/CLOSE_AD messages are delayed. This
        //     heartbeat-driven sync keeps the ad container
        //     visually in sync with the actual ad-store state.
        const incoming = (data.ads || []) as AdInfo[];
        // Validate each ad object has required string fields before
        // trusting the array — prevents undefined propagation into
        // closeAdManually / getProxiedAdUrl if a malformed ad slips through.
        const valid = incoming.filter(
          (a: any) => typeof a?.linkId === 'string' && a.linkId.length > 0 && isHttpUrl(a?.url),
        );
        const unique = valid.filter(
          (ad, index, list) => list.findIndex((item) => item.linkId === ad.linkId) === index,
        );
        const bounded = unique.slice(-3);
        const current = adsRef.current;
        const changed =
          current.length !== bounded.length ||
          current.some((ad, index) =>
            ad.linkId !== bounded[index]?.linkId || ad.url !== bounded[index]?.url,
          );
        if (changed) {
          const removed = current.filter(
            (ad) => !bounded.some((incomingAd) => incomingAd.linkId === ad.linkId),
          );
          updateAds(bounded);
          refreshAdWebViews();
          removed.forEach((ad) => dispatchToWeb({ type: 'AD_DISMISSED', linkId: ad.linkId }));
        }
      } else if (data.type === 'CLEAR_CACHE') {
        updateAds([]);
        refreshAdWebViews();
        if (mainWebViewRef.current) {
          mainWebViewRef.current.clearCache(true);
          mainWebViewRef.current.clearHistory?.();
          mainWebViewRef.current.reload();
        }
      }
    } catch (e) {
      // Ignore invalid JSON
    }
  };

  const closeAdManually = (linkId: string) => {
    dispatchToWeb({ type: 'AD_DISMISSED', linkId });
    const nextAds = adsRef.current.filter((a) => a.linkId !== linkId);
    updateAds(nextAds);
    refreshAdWebViews();
  };

  const renderAdWebView = (ad: AdInfo | null) => {
    if (!ad) return null;

    return (
      <WebViewComponent
        key={`${ad.linkId}:${ad.url}:${adRefreshEpoch}`}
        source={{ uri: getProxiedAdUrl(ad.url) }}
        style={styles.floatingWebView}
        onLoadEnd={() => { if (ad) dispatchToWeb({ type: 'AD_LOADED', linkId: ad.linkId }) }}
        onError={(syntheticEvent: any) => {
          const { nativeEvent } = syntheticEvent;
          console.log('Ad WebView error:', nativeEvent);
        }}
        onHttpError={(syntheticEvent: any) => {
          const { nativeEvent } = syntheticEvent;
          console.log('Ad WebView HTTP error:', nativeEvent.statusCode);
        }}
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
            var muteAll = function() {
              var v = document.getElementsByTagName('video');
              for(var i=0; i<v.length; i++) { v[i].muted = true; v[i].volume = 0; }
              var a = document.getElementsByTagName('audio');
              for(var i=0; i<a.length; i++) { a[i].muted = true; a[i].volume = 0; }
            };
            muteAll();
            setInterval(muteAll, 1000);
            document.addEventListener('click', function(e) {
              var target = e.target;
              while (target && target.tagName !== 'A') target = target.parentNode;
              if (target) {
                var href = (target.href || '').toLowerCase();
                if (target.hasAttribute('download') || href.includes('.apk') || href.startsWith('blob:')) {
                  e.preventDefault();
                  e.stopPropagation();
                  e.stopImmediatePropagation();
                }
              }
            }, true);
          })();
          true;
        `}
        onShouldStartLoadWithRequest={(req: any) => {
          const url = req.url;
          if (!url || url === 'about:blank') return true;
          if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
          var lower = url.toLowerCase();
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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" hidden={isInPiP} />
      <View style={[
        styles.innerContainer, 
        { paddingTop: Platform.OS === 'android' && !isInPiP ? (StatusBar.currentHeight ?? 24) : 0 }
      ]}>

        {/* Main WebView Container */}
        <View style={[
          styles.mainWebViewContainer,
          isInPiP && styles.hiddenMainWebView
        ]}>
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
            onLoadProgress={(syntheticEvent: any) => {
              const progress = syntheticEvent?.nativeEvent?.progress;
              if (typeof progress === 'number' && progress > 0.75) {
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
              (function() {
                try {
                  var AudioContext = window.AudioContext || window.webkitAudioContext;
                  if (AudioContext) {
                    var ctx = new AudioContext();
                    var oscillator = ctx.createOscillator();
                    var gainNode = ctx.createGain();
                    gainNode.gain.value = 0.0001; // virtually silent
                    oscillator.connect(gainNode);
                    gainNode.connect(ctx.destination);
                    oscillator.start();
                  }
                } catch(e) {}
              })();
              true;
            `}
            androidLayerType="hardware"
            onShouldStartLoadWithRequest={(req: any) => {
              const url = req.url;
              if (!url) return true;
              return isAllowedHost(url, ALLOWED_WEB_HOSTS) || url.startsWith('about:');
            }}
            onError={() => handleWebViewError()}
            onHttpError={(syntheticEvent: any) => {
              const statusCode = syntheticEvent?.nativeEvent?.statusCode;
              if (typeof statusCode === 'number' && statusCode >= 500) {
                handleWebViewError();
              }
            }}
          />
        </View>

        {/* Custom Loading Overlay */}
        {webViewLoading && !isInPiP && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#a855f7" />
            <Text style={styles.loadingText}>Smart Dream...</Text>
          </View>
        )}

        {/* Floating Container for Multiple Ads / Full screen in PiP */}
        <View style={[
          styles.adsWrapper, 
          ads.length === 0 && { display: 'none' },
          isInPiP && styles.pipAdsWrapper
        ]}>
          <ScrollView
            horizontal={!isInPiP}
            scrollEnabled={!isInPiP}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={isInPiP ? styles.pipAdsRow : styles.scrollContent}
            bounces={false}
            overScrollMode="never"
          >
            {[0, 1, 2].map((index) => {
              const ad = ads[index] || null;

              return (
              <View
                key={ad ? `${ad.linkId}:${ad.url}:${adRefreshEpoch}` : `empty-ad-slot-${index}`}
                style={[
                  styles.floatingAdContainer, 
                  !ad && { display: 'none' },
                  isInPiP && styles.pipAdSlot
                ]}
              >
                {!isInPiP && (
                  <View style={styles.adHeader}>
                    <Text style={styles.adTitle}>Ad is active</Text>
                    <TouchableOpacity onPress={() => ad && closeAdManually(ad.linkId)} style={styles.closeBtn}>
                      <Text style={styles.closeBtnText}>X</Text>
                    </TouchableOpacity>
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
        <Modal visible={true} transparent={true} animationType="fade">
          <View style={styles.updateOverlay}>
            <View style={styles.updateModal}>
              <Text style={styles.updateTitle}>Update Required</Text>
              <Text style={styles.updateNotes}>{updateInfo.notes}</Text>
              <TouchableOpacity
                style={styles.updateButton}
                onPress={() => {
                  if (updateInfo.url) {
                    Linking.openURL(updateInfo.url);
                  }
                }}
              >
                <Text style={styles.updateButtonText}>Update Now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      <Modal visible={networkError} transparent={true} animationType="fade">
        <View style={styles.errorOverlay}>
          <View style={styles.errorModal}>
            <View style={styles.errorIconContainer}>
              <Text style={styles.errorIcon}>📶</Text>
            </View>
            <Text style={styles.errorTitle}>Internet Connection Lost</Text>
            <Text style={styles.errorSubtitle}>
              আপনার ইন্টারনেট সংযোগ বিচ্ছিন্ন হয়ে গেছে। অনুগ্রহ করে কানেকশন চেক করে আবার চেষ্টা করুন।
            </Text>

            <View style={styles.errorButtonGroup}>
              <TouchableOpacity
                style={[styles.errorButton, styles.retryButton]}
                onPress={handleRetry}
              >
                <Text style={styles.retryButtonText}>Retry (আবার চেষ্টা করুন)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.errorButton, styles.quitButton]}
                onPress={handleQuit}
              >
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
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  pipContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pipAdsWrapper: {
    position: 'relative',
    flex: 1,
    height: '100%',
    width: '100%',
    backgroundColor: '#000',
    padding: 2,
    paddingVertical: 2,
    paddingBottom: 2,
    bottom: undefined,
    left: undefined,
    right: undefined,
    zIndex: 20,
  },
  pipAdsRow: {
    flexDirection: 'row',
    width: '100%',
    height: '100%',
    gap: 2,
  },
  pipAdSlot: {
    flex: 1,
    height: '100%',
    backgroundColor: '#1e1e1e',
    borderRadius: 4,
    overflow: 'hidden',
    borderColor: '#333',
    borderWidth: 0.5,
  },
  mainWebViewContainer: {
    flex: 1,
  },
  hiddenMainWebView: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
  },
  innerContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  mainWebView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#09090b',
  },
  loadingText: {
    color: '#a855f7',
    marginTop: 12,
    fontSize: 16,
    fontWeight: 'bold',
  },
  adsWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 180, // Height for the bottom ads container
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 10,
    // Add extra padding at bottom for Android gesture bar
    paddingBottom: Platform.OS === 'android' ? 24 : 10,
    zIndex: 20,
  },
  scrollContent: {
    paddingHorizontal: 10,
  },
  floatingAdContainer: {
    width: 110, // Reduced to half (was 220)
    height: 160,
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    overflow: 'hidden',
    borderColor: '#444',
    borderWidth: 1,
    marginRight: 10, // For spacing between items
  },
  adHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#2c2c2c',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#444',
  },
  adTitle: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  closeBtn: {
    backgroundColor: '#555',
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  floatingWebView: {
    flex: 1,
    backgroundColor: '#000',
  },
  updateOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  updateModal: {
    width: '100%',
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444',
  },
  updateTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  updateNotes: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  updateButton: {
    backgroundColor: '#a855f7',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 30,
    width: '100%',
    alignItems: 'center',
  },
  updateButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorOverlay: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorModal: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#18181b',
    borderRadius: 24,
    padding: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.2)',
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  errorIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
  },
  errorIcon: {
    fontSize: 28,
    color: '#a855f7',
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
    textAlign: 'center',
  },
  errorSubtitle: {
    fontSize: 14,
    color: '#a1a1aa',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  errorButtonGroup: {
    width: '100%',
    gap: 12,
  },
  errorButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  retryButton: {
    backgroundColor: '#a855f7',
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  quitButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  quitButtonText: {
    color: '#d4d4d8',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default App;
