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

export const getSettings = cache(async (): Promise<SiteSettings> => {
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
    return DEFAULTS;
  }

  return {
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
});
