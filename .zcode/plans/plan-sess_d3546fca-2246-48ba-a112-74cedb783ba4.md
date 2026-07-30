# Fix: Mobile App Login — `allowedOrigins` Missing Production Domains

## Root Cause
`next.config.ts`-এর `experimental.serverActions.allowedOrigins`-এ production domain `smart-dream-admin.vercel.app` missing। Mobile WebView থেকে login form submit করলে Next.js 15 server action-এর `Origin` header check fail করে এবং request reject করে।

## Fix
`next.config.ts`-এ `allowedOrigins`-এ যোগ করতে হবে:
- `"smart-dream-admin.vercel.app"` (mobile app-এর main URL)
- `"smart-dream.vercel.app"` (alternate domain)
- `"*.vercel.app"` (Vercel preview deployments-এর জন্য)

### File to edit:
- `next.config.ts` line 22-28

### Change:
```diff
allowedOrigins: [
  "smart-dream.smartdream.workers.dev",
  "*.workers.dev",
  "localhost:3000",
  "localhost:8787",
  "sd.raiyan.io",
+ "smart-dream-admin.vercel.app",
+ "smart-dream.vercel.app",
+ "*.vercel.app",
],
```