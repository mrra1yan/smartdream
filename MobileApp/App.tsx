import React, { useRef, useState, useEffect } from 'react';
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
  NativeModules,
  NativeEventEmitter,
  PermissionsAndroid,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

const { FloatingWidgetModule, PipModule } = NativeModules;

const WebViewComponent = WebView as any;

const CONFIG_URL = 'https://ihhpybntlaqvbhdmksjl.supabase.co/storage/v1/object/public/app-config/config.json';
const APP_VERSION = '1.0.0';
const DEFAULT_WEB_URL = 'https://smart-dream-admin.vercel.app';
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
  'smart-dream.vercel.app',
  'smart-dream.smartdream.workers.dev',
  'sd.raiyan.io',
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

function App(): React.JSX.Element {
  const mainWebViewRef = useRef<WebView>(null);
  const [ads, setAds] = useState<AdInfo[]>([]);
  const [updateInfo, setUpdateInfo] = useState<{ isRequired: boolean; url: string; notes: string } | null>(null);
  const [webUrl, setWebUrl] = useState<string>(DEFAULT_WEB_URL);
  const [configError, setConfigError] = useState<boolean>(false);
  const [networkError, setNetworkError] = useState<boolean>(false);
  const [pipActive, setPipActive] = useState<boolean>(false);

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
  adsRef.current = ads;
  const appStateRef = useRef<string>(AppState.currentState);
  const autoLikeActiveRef = useRef<boolean>(false);
  const pipActiveRef = useRef<boolean>(false);

  useEffect(() => {
    fetchConfig();

    if (Platform.OS === 'android') {
      if (Platform.Version >= 33) {
        void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      }
    }

    // ── PiP mode change listener ─────────────────────────────────────
    // MainActivity.onPictureInPictureModeChanged() emits this event.
    // When PiP is active we hide the main WebView so only ad content is
    // visible in the floating PiP window.
    let pipEventSubscription: any = null;
    if (Platform.OS === 'android' && PipModule) {
      try {
        const pipEmitter = new NativeEventEmitter(PipModule);
        pipEventSubscription = pipEmitter.addListener('onPipModeChanged', (event: boolean) => {
          setPipActive(event);
          pipActiveRef.current = event;
          if (event) {
            // ── PiP just activated ─────────────────────────────────────
            // The Activity is now paused (onPause fired). React Native's JS
            // thread may be suspended by the OS, which would stop the
            // HEARTBEAT setInterval → main WebView JS timers get throttled
            // → ads stop auto-closing. Start the FloatingWidgetService as a
            // foreground service to keep the process alive and the HEARTBEAT
            // pumping every second, just like the old overlay approach.
            if (adsRef.current.length > 0 && autoLikeActiveRef.current && FloatingWidgetModule) {
              FloatingWidgetModule.startService(JSON.stringify(adsRef.current));
            }
          } else {
            // ── PiP dismissed (user tapped to return or swiped away) ────
            // Keep the foreground service running as a fallback — the
            // process is still backgrounded.
            if (adsRef.current.length > 0 && autoLikeActiveRef.current && FloatingWidgetModule) {
              FloatingWidgetModule.startService(JSON.stringify(adsRef.current));
            }
          }
        });
      } catch (_) {
        // PipModule not available on this device/OS version — fall through
        // to FloatingWidgetService-only path.
      }
    }

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      appStateRef.current = nextAppState;
      if (Platform.OS === 'android') {
        const hasAds = adsRef.current.length > 0 && autoLikeActiveRef.current;

        if (nextAppState === 'background' || nextAppState === 'inactive') {
          // ── PiP path (Android 8+, no permission needed) ───────────
          // PipModule.setPipReady(true) tells MainActivity.onUserLeaveHint()
          // to call enterPictureInPictureMode() on the next Home press.
          // We don't start FloatingWidgetService here — PiP handles it.
          if (PipModule && hasAds) {
            PipModule.setPipReady(true, JSON.stringify(adsRef.current));
          }

          // ── Fallback: FloatingWidgetService for pre-API-26 ────────
          // Only start the overlay service if PipModule is NOT available.
          // The overlay service requires SYSTEM_ALERT_WINDOW permission —
          // users on Android 8+ should never need to grant this.
          if (!PipModule && FloatingWidgetModule && hasAds) {
            FloatingWidgetModule.startService(JSON.stringify(adsRef.current));
          }
        } else if (nextAppState === 'active') {
          // ── Coming back to foreground ─────────────────────────────
          // Disable PiP readiness (onUserLeaveHint won't fire now).
          PipModule?.setPipReady(false, '[]');
          setPipActive(false);
          pipActiveRef.current = false;

          // Stop any floating widget fallback service.
          if (FloatingWidgetModule) {
            FloatingWidgetModule.stopService();
            setTimeout(() => {
              if (appStateRef.current === 'active') {
                FloatingWidgetModule.stopService();
              }
            }, 200);
          }
        }
      }
    });

    return () => {
      subscription.remove();
      if (pipEventSubscription) {
        pipEventSubscription.remove();
      }
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'android') {
      // ── Keep PipModule in sync with current ad state ─────────────
      // Whenever ads or auto-like state changes, update PipModule so
      // onUserLeaveHint() always has the latest picture.
      if (ads.length > 0 && autoLikeActiveRef.current) {
        PipModule?.setPipReady(true, JSON.stringify(ads));
      } else {
        PipModule?.setPipReady(false, '[]');
      }

      if (FloatingWidgetModule) {
        // Keep service running when backgrounded + auto-like active.
        // If ads are temporarily 0 but PiP is active and auto-like is
        // running, DON'T stop — the auto-like loop will fetch new ads
        // within seconds, and stopping/recreating the foreground service
        // creates a kill window where aggressive OEMs could terminate
        // the process before new ads arrive.
        const inBackground = appStateRef.current === 'background' || appStateRef.current === 'inactive';
        const shouldRun = autoLikeActiveRef.current && inBackground &&
          (ads.length > 0 || pipActiveRef.current);

        if (shouldRun) {
          FloatingWidgetModule.updateAds(JSON.stringify(ads));
        } else {
          FloatingWidgetModule.stopService();
        }
      }
    }
  }, [ads]);

  useEffect(() => {
    // Keep WebView timers alive in the background
    // When the app has an active Foreground Service (PiP), the RN JS thread
    // stays awake. By pinging the WebView every second, we force Chromium
    // to process its JS task queue, bypassing the 1-minute background timer
    // throttling that would otherwise break the Auto-Like 9-second intervals.
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
    await fetchConfig();
    if (mainWebViewRef.current) {
      mainWebViewRef.current.reload();
    }
  };

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
        if (!isHttpUrl(data.url)) {
          // Defend the bridge itself, independent of the web layer's own
          // UrlSchema check (src/app/actions/links.ts) -- never load
          // javascript:/file:/intent:/etc. into the ad WebView.
          console.log('Rejected OPEN_AD with disallowed URL scheme:', data.url);
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
        setAds((prev) => {
          if (prev.find((a) => a.linkId === data.linkId)) return prev;
          // Keep up to 3 ads concurrently
          const nextAds = [...prev, { url: data.url, linkId: data.linkId }];
          if (nextAds.length > 3) {
            // Tell the web layer these got dropped so their slots don't
            // hang forever waiting for an AD_LOADED that will never come.
            const evicted = nextAds.slice(0, nextAds.length - 3);
            evicted.forEach((ad) => dispatchToWeb({ type: 'AD_DISMISSED', linkId: ad.linkId }));
            return nextAds.slice(nextAds.length - 3);
          }
          return nextAds;
        });
      } else if (data.type === 'SYNC_AUTO_LIKE_STATUS') {
        autoLikeActiveRef.current = data.active === true;

        // Immediately stop service if status became inactive while running
        if (!autoLikeActiveRef.current && Platform.OS === 'android') {
          if (FloatingWidgetModule) {
            FloatingWidgetModule.stopService();
          }
          // Also disable PiP readiness so onUserLeaveHint won't trigger
          PipModule?.setPipReady(false, '[]');
        }
      } else if (data.type === 'CLOSE_AD') {
        setAds((prev) => prev.filter((a) => a.linkId !== data.linkId));
      } else if (data.type === 'CLEAR_CACHE') {
        // Drop any floating ad WebViews too -- they belong to the web
        // layer's ad-store state, which is about to be wiped by the reload
        // below, so leaving them mounted would orphan them.
        setAds([]);
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
    setAds((prev) => prev.filter((a) => a.linkId !== linkId));
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View style={[styles.innerContainer, { paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 }]}>

        {/* ── PiP indicator banner (shown at top when PiP is active) ── */}
        {pipActive && (
          <View style={styles.pipBanner}>
            <Text style={styles.pipBannerText}>⚡ Auto-Like running · Tap PiP to return</Text>
          </View>
        )}

        {/* Main WebView — visually hidden in PiP mode (positioned off-screen)
            but NEVER unmounted — unmounting would kill all JS timers (ad
            countdown, auto-like loop, heartbeat) running inside it. */}
        <WebViewComponent
          ref={mainWebViewRef}
          source={{ uri: webUrl }}
          style={styles.mainWebView}
          onMessage={onMainMessage}
          onLoadEnd={() => dispatchToWeb({ type: 'BRIDGE_INIT' })}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          startInLoadingState={true}
          cacheEnabled={true}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={true}
          androidLayerType="hardware"
          onError={() => setNetworkError(true)}
          onHttpError={(syntheticEvent: any) => {
            const { nativeEvent } = syntheticEvent;
            if (nativeEvent.statusCode >= 500) {
              setNetworkError(true);
            }
          }}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#a855f7" />
              <Text style={styles.loadingText}>Smart Dream...</Text>
            </View>
          )}
        />
        {pipActive && <View style={styles.pipOverlay} pointerEvents="none" />}

        {/* Floating Container for Multiple Ads at the bottom */}
        {/* Always visible — in normal mode it sits at the bottom, and in PiP
            mode it fills the entire PiP window since the main WebView is hidden. */}
        {ads.length > 0 && (
          <View style={[styles.adsWrapper, pipActive && styles.adsWrapperPip]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent} bounces={false} overScrollMode="never">
              {ads.map((ad) => (
                <View key={ad.linkId} style={[styles.floatingAdContainer, pipActive && styles.floatingAdContainerPip]}>
                  <View style={styles.adHeader}>
                    <Text style={styles.adTitle}>Ad is active</Text>
                    <TouchableOpacity onPress={() => closeAdManually(ad.linkId)} style={styles.closeBtn}>
                      <Text style={styles.closeBtnText}>X</Text>
                    </TouchableOpacity>
                  </View>
                  <WebViewComponent
                    source={{ uri: ad.url }}
                    style={styles.floatingWebView}
                    onLoadEnd={() => dispatchToWeb({ type: 'AD_LOADED', linkId: ad.linkId })}
                    allowsInlineMediaPlayback
                    mediaPlaybackRequiresUserAction={false}
                    javaScriptEnabled
                    domStorageEnabled
                    // ── Chrome Mobile user-agent ──────────────────────────
                    // Default WebView UA includes app identifiers that ad
                    // networks flag as "in-app traffic" → lower CPM. A clean
                    // Chrome UA signals standard mobile browser traffic.
                    userAgent="Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
                    // ── Block malicious popups & downloads ─────────────────
                    // Override alert/confirm/prompt — malicious ad scripts use
                    // these to show fake "file downloaded" dialogs.
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
                      })();
                      true;
                    `}
                    onShouldStartLoadWithRequest={(req: any) => {
                      const u = (req.url || '').toLowerCase();
                      if (
                        u.startsWith('intent://') ||
                        u.startsWith('market://') ||
                        u.startsWith('tel:') ||
                        u.startsWith('sms:') ||
                        u.includes('.apk')
                      ) return false;
                      return true;
                    }}
                    setSupportMultipleWindows={false}
                    // Ad content is untrusted third-party. Lock cookies down
                    // on this WebView specifically (per-instance prop, does
                    // not affect the main WebView above) so the app's own
                    // session cookie can never leak into ad content, and ad
                    // content can't set cookies that ride along elsewhere.
                    sharedCookiesEnabled={false}
                    thirdPartyCookiesEnabled={false}
                    cacheEnabled={true}
                    androidLayerType="hardware"
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        )}
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
  innerContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  pipBanner: {
    backgroundColor: '#a855f7',
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  pipBannerText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  pipOverlay: {
    // Covers the main WebView with black when PiP is active.
    // The WebView stays mounted (timers keep running) but is visually hidden.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 10,
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
  },
  adsWrapperPip: {
    // In PiP mode, fill the entire window since main WebView is hidden
    top: 0,
    height: undefined as any,
    flex: 1,
    backgroundColor: '#000',
    paddingVertical: 4,
    paddingBottom: 4,
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
  floatingAdContainerPip: {
    // In PiP mode, make ad containers adapt to the PiP window size
    width: 140,
    height: '100%' as any,
    flex: 1,
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
