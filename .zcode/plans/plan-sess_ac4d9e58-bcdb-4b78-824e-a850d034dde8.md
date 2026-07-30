# Fix: `MIDDLEWARE_INVOCATION_TIMEOUT`

## Root Cause

Middleware calls `supabase.auth.getUser()` on **every** request (line 99), which makes an outbound HTTP call to Supabase's auth server. On Vercel's Edge Runtime this can timeout when Supabase is slow or the network is congested.

```
getUser() → HTTP round-trip to Supabase → timeout on Edge
```

## Fix: Switch `getUser()` → `getSession()`

`getSession()` reads the JWT from the cookie and decodes it **locally** — zero network calls. This is the [Supabase-recommended approach for middleware](https://supabase.com/docs/guides/auth/server-side/nextjs).

### What changes (1 file, 3 lines):

**File:** `src/middleware.ts`

**Before (lines 96-99):**
```typescript
const {
  data: { user },
} = await supabase.auth.getUser();
```

**After:**
```typescript
const {
  data: { session },
} = await supabase.auth.getSession();
const user = session?.user ?? null;
```

### Trade-off:
- ✅ No network call → no timeout
- ✅ JWT still verified cryptographically (signed token, can't be forged)
- ✅ `session.user.user_metadata` has same shape — `role` and `status` still accessible
- ⚠️ Token refresh no longer happens in middleware — but it still happens in server components via `createSupabaseServerClient()` which calls `getUser()` separately

### Lines changed:
- Line 97-99: `getUser()` → `getSession()` + extract `user` from `session`