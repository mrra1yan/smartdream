/**
 * Row types for the application tables in Supabase Postgres.
 *
 * NOTE on clients: historically this module also created the single shared
 * Supabase client. Auth has since moved to Supabase Auth (`@supabase/ssr`),
 * so there are now three client entry points:
 *
 *   - `@/lib/supabase/server`  → `createSupabaseServerClient()` — user-scoped,
 *                                RLS-aware, for server components/actions/routes.
 *   - `@/lib/supabase/client`  → `createSupabaseBrowserClient()` — for client
 *                                components.
 *   - `@/lib/supabase/admin`   → `supabaseAdmin` — service-role, RLS bypass,
 *                                `"server-only"`.
 *
 * For backward compatibility the privileged `supabase` client (service role)
 * is still re-exported from here so existing server-side call-sites keep
 * working. Prefer the explicit imports above for new code.
 */

export { supabaseAdmin } from "@/lib/supabase/admin";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Backward-compatible privileged client (service role, RLS bypass).
 * Server-only — never import from a Client Component.
 */
export const supabase = supabaseAdmin;

export type Profile = {
  id: string;
  public_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  /**
   * @deprecated Passwords are now owned by Supabase Auth (`auth.users`).
   * Kept on the row type only so legacy references compile; the column is
   * dropped by the migration and should not be read or written.
   */
  password_hash?: string;
  role: "user" | "admin" | "super_admin";
  status: "pending" | "approved" | "rejected";
  is_elite: boolean;
  is_boosted: boolean;
  boost_order: number | null;
  boost_model: "none" | "no_expiry" | "time" | "usage";
  boost_expiry: string | null;
  boost_quota: number | null;
  boost_used: number;
  auto_like_enabled: boolean;
  auto_like_model: "none" | "no_expiry" | "time" | "usage";
  auto_like_expiry: string | null;
  auto_like_quota: number | null;
  auto_like_used: number;
  free_autolike_until: string | null;
  auto_like_paused: boolean;
  auto_like_paused_remaining_minutes: number | null;
  free_autolike_paused_remaining_minutes: number | null;
  boosted_offer_count: number;
  referred_by: string | null;
  approved_by: string | null;
  created_at: string;
};

export type Link = {
  id: string;
  user_id: string;
  url: string;
  likes_count: number;
  sort_order: number;
  created_at: string;
};

export type Like = {
  id: string;
  liker_id: string | null;
  link_id: string;
  receiver_id: string;
  is_anonymous: boolean;
  is_boosted_like: boolean;
  created_at: string;
};

export type Blog = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string | null;
  hero_image: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type Settings = {
  id: string;
  whatsapp_number: string;
  active_like_count: number;
  active_window_hours: number;
  elite_weight: number;
  offer_likes_required: number;
  offer_autolike_minutes: number;
  offer_active: boolean;
  boost_price_no_expiry: number | null;
  boost_price_1w: number | null;
  boost_price_1m: number | null;
  boost_price_3m: number | null;
  boost_price_6m: number | null;
  boost_price_1y: number | null;
  boost_price_usage_per_unit: number | null;
  autolike_price_no_expiry: number | null;
  autolike_price_1w: number | null;
  autolike_price_1m: number | null;
  autolike_price_3m: number | null;
  autolike_price_6m: number | null;
  autolike_price_1y: number | null;
  autolike_price_usage_per_unit: number | null;
  referral_reward_referrer_minutes: number;
  referral_reward_referee_minutes: number;
  level1_name: string;
  level1_threshold: number;
  level2_name: string;
  level2_threshold: number;
  level3_name: string;
  level3_threshold: number;
  level4_name: string;
  level4_threshold: number;
  created_at: string;
  updated_at: string;
};
