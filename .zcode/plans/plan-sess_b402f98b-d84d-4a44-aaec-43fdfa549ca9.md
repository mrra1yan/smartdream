## Fix: Revert session.ts to original code

### Problem
Login loop happening because `getSession()` changes (cookie decode → then `getSession()`) are breaking session persistence after login.

### Root Cause Investigation
Two changes were made to `session.ts`:
1. Replaced `getUser()` with `getSession()` / cookie decode
2. Added React `cache()` wrapper

One or both of these is causing session to return null after successful login, triggering redirect back to `/login`.

### Fix
**Revert `src/lib/session.ts` to the EXACT original code** that was working before. No `cache()`, use original `getUser()`.

This ensures login works immediately. Performance optimization can be attempted incrementally afterward.

### Files changed
- `src/lib/session.ts` — restore original `getSession()` implementation

### Note
The `session-cookie.ts` shared utility and middleware refactor are retained (they work fine). PageMotion fix is also retained.