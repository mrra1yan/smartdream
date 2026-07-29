## Fix 1: Sync active ads to native via HEARTBEAT response

**Problem:** When app is backgrounded, Chromium throttles the WebView's JS timers. The HEARTBEAT keeps ad timers alive, but the visual ad state never reaches the FloatingWidgetService because React re-renders (which send OPEN_AD/CLOSE_AD to native) are also throttled.

**Changes:**

1. **`src/components/ad-container.tsx`** — In the HEARTBEAT handler (line ~253), after `tickHeartbeat()`, send current `active` ads to native via a new `SYNC_ADS` postMessage. This bypasses React's throttled render cycle.

2. **`MobileApp/App.tsx`** — Add handler for `SYNC_ADS` in `onMainMessage`. Compare incoming ads (by linkId set) with current state and only call `setAds()` if they differ, to avoid unnecessary FloatingWidgetService restarts.

## Fix 2: Secure popup WebViews in FloatingWidgetService

**Problem:** `FloatingWidgetService.kt` has `javaScriptCanOpenWindowsAutomatically = true` + `onCreateWindow` that creates bare, unsecured popup WebViews with default settings (file access enabled, no URL filtering, no download blocking). Malicious ads use `window.open()` to load malware pages that hijack ad slots and block auto-like.

**Changes:**

1. **`MobileApp/android/app/src/main/java/com/smartdreamapp/FloatingWidgetService.kt`** — In `onCreateWindow`:
   - Apply the same security to popup WebViews: `allowFileAccess = false`, `setSupportMultipleWindows(false)`, URL filtering via `shouldOverrideUrlLoading`, download blocking, JS injection for mute + alert/confirm/prompt override
   - Block non-HTTP(S) and `.apk` popup URLs before loading