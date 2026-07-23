import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client authenticated with the **service-role key**. Bypasses Row
 * Level Security entirely and can call the Auth admin API
 * (`auth.admin.createUser`, `auth.admin.updateUserById`, ...).
 *
 * Use this only for privileged operations that must run server-side with
 * elevated privileges: admin creating/promoting/resetting other users,
 * cross-user queries, back-office tasks.
 *
 * This module is guarded by `"server-only"` so it can never be pulled into a
 * client bundle. The service-role key must NEVER be exposed to the browser.
 */
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      // Service-role clients never have a user session; disable all session
      // persistence so no storage is touched.
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
