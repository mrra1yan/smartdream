# Plan: Strict Ad WebView Security Hardening

## Requirements (user's instructions)
1. ✅ **Ad jeno block na kore** — ads must load and display properly
2. ✅ **Ad er majhe jeno malware app download na hoy** — no APK/file downloads
3. ✅ **Ad theke jeno onno kono link open na hoy** — no navigation to external links
4. ✅ **Ad theke jeno onno app e forward na kore** — no app redirects (intent://, market://, etc.)

## Architecture
Two-layer security: **Server-side** (already done via `/api/embed-frame` proxy) + **Client-side** (WebView hardening). The proxy handles redirects and SSRF, the WebView handles post-load interaction blocking.

---

## Changes

### 1. `MobileApp/App.tsx` — Harden `onShouldStartLoadWithRequest`

**Current:** Blocks only specific dangerous patterns (intent://, market://, .apk, play.google.com, etc.) — allows everything else.
**Problem:** User clicks an ad link → WebView navigates to external site → breaks rule #3.

**New approach:** Allow ONLY our proxy domain. Block everything else.

```javascript
onShouldStartLoadWithRequest={(req: any) => {
  const url = (req.url || '').toLowerCase();
  // Allow about:blank (initial empty state)
  if (url === 'about:blank') return true;
  // Allow only our proxy domain (all ad content goes through /api/embed-frame)
  // This blocks ALL external navigation while allowing the proxy to serve ad content
  try {
    const parsed = new URL(req.url);
    const base = new URL(webUrl);
    if (parsed.origin === base.origin) return true;
  } catch (_) {}
  // Block: intent://, market://, tel:, sms:, external http/https, everything else
  return false;
}}
```

This means:
- Initial ad load via proxy → allowed (our domain)
- Any click/link/redirect → blocked (external domain)
- App schemes (intent://, market://) → blocked (not our domain)

### 2. `MobileApp/App.tsx` — Enhanced injected JavaScript

**Expand `window.location` hijack** — currently only blocks Play Store / App Store. Expand to block ALL external URLs that would navigate away:

```javascript
// Block ALL external redirects, not just Play Store
try {
  var _loc = window.location;
  var _origin = window.location.origin;
  Object.defineProperty(window, 'location', {
    get: function(){ return _loc; },
    set: function(v) {
      var s = String(v);
      // Allow same-origin navigations (proxy content)
      try {
        if (new URL(s, _loc.href).origin === _origin) {
          _loc.href = v;
        }
      } catch(e) {
        // Invalid URL — block
      }
    }
  });
} catch(e) {}
```

**Add `assign` and `replace` method blocking:**
```javascript
try {
  window.location.assign = function(){};
  window.location.replace = function(){};
} catch(e) {}
```

**Add form submission prevention** (some malware uses hidden forms):
```javascript
document.addEventListener('submit', function(e) {
  e.preventDefault();
  e.stopPropagation();
}, true);
```

**Keep existing protections:**
- `window.alert`, `window.confirm`, `window.prompt` → disabled
- `window.open` → returns null
- APK download click interception
- Audio muting

### 3. `MobileApp/App.tsx` — Minor: ensure `getProxiedAdUrl` origin matches `isProxyUrl` logic

Both use the same origin extraction pattern — verified consistent.

---

## Security Coverage Summary

| Threat | Layer | Protection |
|--------|-------|------------|
| Ad network redirects to Play Store | Server (proxy) + WebView (onShouldStartLoadWithRequest) | Proxy follows redirects server-side; WebView blocks non-proxy URLs |
| Malicious APK download | JS (click interceptor) | Blocks `.apk` URLs and `download` attribute clicks |
| `intent://` app redirects | WebView (onShouldStartLoadWithRequest) | Blocked — not our domain |
| `market://` app store | WebView | Blocked |
| `window.open` popups | JS | Returns null |
| `window.location` external redirect | JS | Blocks non-same-origin assignments |
| `location.assign/replace` bypass | JS | Methods no-oped |
| Hidden form submission | JS | All submits prevented |
| Fake alert/confirm dialogs | JS | Disabled |
| SSRF / private IP access | Server (proxy) | DNS pinning, private IP blocking, 5-hop redirect limit |
| Session cookie leak | WebView config | `sharedCookiesEnabled={false}` |

---

## Files Modified
- **`MobileApp/App.tsx`** — ad WebView section only (~lines 431-488): updated `injectedJavaScript` and `onShouldStartLoadWithRequest`

## What stays unchanged
- `getProxiedAdUrl()` — proxy routing (already working)
- Error handlers on WebView
- Chrome UA spoof
- Non-PiP bottom ad container layout
- HEARTBEAT system
- All other App.tsx logic
