import "server-only";
import { cache } from "react";
import { supabase, Settings } from "@/lib/supabase";

export type SiteSettings = {
  whatsappNumber: string;
  activeLikeCount: number;
  activeWindowHours: number;
  eliteWeight: number;
  offerLikesRequired: number;
  offerAutoLikeMinutes: number;
  offerActive: boolean;
  boostPriceNoExpiry: number | null;
  boostPrice1w: number | null;
  boostPrice1m: number | null;
  boostPrice3m: number | null;
  boostPrice6m: number | null;
  boostPrice1y: number | null;
  boostPriceUsagePerUnit: number | null;
  autolikePriceNoExpiry: number | null;
  autolikePrice1w: number | null;
  autolikePrice1m: number | null;
  autolikePrice3m: number | null;
  autolikePrice6m: number | null;
  autolikePrice1y: number | null;
  autolikePriceUsagePerUnit: number | null;
  referralRewardReferrerMinutes: number;
  referralRewardRefereeMinutes: number;
};

const DEFAULTS: SiteSettings = {
  whatsappNumber: "",
  activeLikeCount: 20,
  activeWindowHours: 24,
  eliteWeight: 10,
  offerLikesRequired: 10,
  offerAutoLikeMinutes: 30,
  offerActive: true,
  boostPriceNoExpiry: null,
  boostPrice1w: null,
  boostPrice1m: null,
  boostPrice3m: null,
  boostPrice6m: null,
  boostPrice1y: null,
  boostPriceUsagePerUnit: null,
  autolikePriceNoExpiry: null,
  autolikePrice1w: null,
  autolikePrice1m: null,
  autolikePrice3m: null,
  autolikePrice6m: null,
  autolikePrice1y: null,
  autolikePriceUsagePerUnit: null,
  referralRewardReferrerMinutes: 60,
  referralRewardRefereeMinutes: 30,
};

// Module-level TTL cache, shared across requests on the same warm
// server/isolate (React's cache() below only dedupes within a single
// request). getSettings() is called on nearly every page load and on every
// like commit, but the settings row itself only ever changes when an admin
// edits it via the settings page -- so refetching it fresh on every single
// request is a lot of Supabase egress for data that's the same 99.9% of the
// time. A 45s staleness window is the trade-off: an admin's settings change
// can take up to 45s to take effect everywhere, same order of magnitude as
// the staleness already accepted for feed likes_count.
const SETTINGS_CACHE_TTL_MS = 45_000;
let cachedSettings: { value: SiteSettings; expiresAt: number } | null = null;

/** Call after any write to the `settings` table so the admin who just saved
 * sees their own change immediately instead of waiting out the TTL. */
export function invalidateSettingsCache(): void {
  cachedSettings = null;
}

export const getSettings = cache(async (): Promise<SiteSettings> => {
  if (cachedSettings && cachedSettings.expiresAt > Date.now()) {
    return cachedSettings.value;
  }

  let row: Settings | undefined;

  try {
    const { data, error } = await supabase
      .from("settings")
      .select("*")
      .eq("id", "1")
      .single();

    if (error || !data) {
      throw new Error("Settings not found");
    }
    row = data as Settings;
  } catch (error) {
    console.error("[SETTINGS] Unable to load site settings:", error);
    // Don't cache a failure -- a transient outage shouldn't force every
    // request for the next 45s to silently fall back to DEFAULTS once the
    // DB recovers before the TTL expires.
    return cachedSettings?.value ?? DEFAULTS;
  }

  const settings = {
    whatsappNumber: row.whatsapp_number ?? "",
    activeLikeCount: row.active_like_count ?? DEFAULTS.activeLikeCount,
    activeWindowHours: row.active_window_hours ?? DEFAULTS.activeWindowHours,
    eliteWeight: row.elite_weight ?? DEFAULTS.eliteWeight,
    offerLikesRequired: row.offer_likes_required ?? DEFAULTS.offerLikesRequired,
    offerAutoLikeMinutes:
      row.offer_autolike_minutes ?? DEFAULTS.offerAutoLikeMinutes,
    offerActive: row.offer_active ?? DEFAULTS.offerActive,
    boostPriceNoExpiry: row.boost_price_no_expiry ?? null,
    boostPrice1w: row.boost_price_1w ?? null,
    boostPrice1m: row.boost_price_1m ?? null,
    boostPrice3m: row.boost_price_3m ?? null,
    boostPrice6m: row.boost_price_6m ?? null,
    boostPrice1y: row.boost_price_1y ?? null,
    boostPriceUsagePerUnit: row.boost_price_usage_per_unit ?? null,
    autolikePriceNoExpiry: row.autolike_price_no_expiry ?? null,
    autolikePrice1w: row.autolike_price_1w ?? null,
    autolikePrice1m: row.autolike_price_1m ?? null,
    autolikePrice3m: row.autolike_price_3m ?? null,
    autolikePrice6m: row.autolike_price_6m ?? null,
    autolikePrice1y: row.autolike_price_1y ?? null,
    autolikePriceUsagePerUnit: row.autolike_price_usage_per_unit ?? null,
    referralRewardReferrerMinutes: row.referral_reward_referrer_minutes ?? DEFAULTS.referralRewardReferrerMinutes,
    referralRewardRefereeMinutes: row.referral_reward_referee_minutes ?? DEFAULTS.referralRewardRefereeMinutes,
  };

  cachedSettings = { value: settings, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS };
  return settings;
});
