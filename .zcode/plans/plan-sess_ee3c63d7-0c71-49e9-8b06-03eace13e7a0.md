# PiP Ad Display Fix Plan — সম্পূর্ণ নতুন approach

## 🔍 Root Cause (মূল সমস্যা)

বর্তমানে PiP mode এ ad গুলো **আলাদা React Native WebView** এ দেখানো হয়। Main WebView (যেখানে auto-like loop + ad store চলে) থেকে **SYNC_ADS message** পাঠিয়ে ad update করা হয়। কিন্তু PiP mode এ:
- React Native JS thread থ্রটল হয় → message passing unreliable
- Main WebView hidden + paused → injectJavaScript কাজ করে না
- React re-render থ্রটল হয় → OPEN_AD/CLOSE_AD mount/unmount effect fire হয় না

**ফলাফল:** Ad store-এ ad cycle ঠিকমতো হলেও PiP display update হয় না। এটি আমার change-এর আগে থেকেই ছিল (pre-existing bug)।

## 🎯 Solution: ONE JavaScript Context

**Main WebView-এই সরাসরি ad render করব।** PiP window তো main WebView-ই (Activity shrink করে)। Main WebView-এর ভিতরে browser-style iframe overlay হিসেবে ad দেখালে:
- Ad গুলো auto-like loop-এর same JS context-এ চলে → কোনো message passing লাগবে না
- React naturally re-render হবে → ad auto-change হবে
- আলাদা কোনো WebView লাগবে না

## 📋 Implementation Steps

### Step 1: App.tsx — PiP activation message পাঠানো
- `onPipModeChanged` event-এ main WebView-কে `PIP_MODE` message পাঠাবো
- PiP activate: `{type: 'PIP_MODE', active: true}`
- PiP deactivate: `{type: 'PIP_MODE', active: false}`
- **pipOverlay সরিয়ে ফেলব** — main WebView show করার জন্য pipOverlay দরকার নেই

### Step 2: ad-container.tsx — PIP_MODE message handle
- Module-level `pipMode` variable যোগ করব
- `PIP_MODE` message listener যোগ করব
- `pipMode === true` হলে native app-এইও browser-style ad overlay দেখাবো

### Step 3: AdModal — PiP mode এ browser overlay
- `isNativeApp && !pipMode` → native delegation (normal mode)
- `pipMode` → browser-style iframe overlay (PiP mode)
- Overlay গুলো full-screen দেখাবে, countdown সহ

### Step 4: globals.css — PiP mode CSS
- `.pip-mode` class: app chrome (nav, sidebar, main content) hide করে
- Ad container full-screen দেখায়
- PiP window ছোট, তাই layout optimize করব

### Step 5: App.tsx — PiP ad WebViews disable
- PiP active হলে bottom ad WebView container hide করব
- Main WebView-এই ad গুলো দেখাবে (pipOverlay ছাড়া)

## 📊 Flow Comparison

| | পুরনো approach | নতুন approach |
|---|---|---|
| Ad display | আলাদা RN WebViews | Main WebView-এর iframe |
| Update mechanism | SYNC_ADS message | React natural re-render |
| JS context | 2 টা আলাদা context | 1 টাই context |
| Reliability in PiP | ❌ unreliable | ✅ reliable |
| Permission needed | Zero | Zero |
| Code complexity | High (bridge + sync) | Low (pure React) |

## 📁 Changed Files

| File | Change |
|------|--------|
| `App.tsx` | pipOverlay remove, PIP_MODE message send on PiP change, hide ad WebViews during PiP |
| `ad-container.tsx` | pipMode state, PIP_MODE listener, force browser rendering in PiP |
| `globals.css` | `.pip-mode` CSS rules to hide app chrome |

## ⚡ যা থাকছে unchanged
- Auto-like loop (use-autolike.ts)
- Ad store (ad-store.ts)
- KeepAliveService
- PiP enter/exit logic (MainActivity.kt, PipModule.kt)
- Server-side code