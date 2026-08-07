export type Role = "user" | "admin" | "super_admin";

export type ProfileStatus = "pending" | "approved" | "rejected";

export type FeatureModel = "none" | "no_expiry" | "time" | "usage";

export type TimePreset = "1w" | "1m" | "3m" | "6m" | "1y";

export const TIME_PRESET_DAYS: Record<TimePreset, number> = {
  "1w": 7,
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
};

export type Locale = "en" | "bn";

export const LOCALES: Locale[] = ["en", "bn"];
export const DEFAULT_LOCALE: Locale = "en";

export const MAX_LINKS_PER_USER = 50;
export const AD_LOADING_SECONDS = 4;
export const AD_VIEW_SECONDS = 10;
export const TOTAL_AD_SECONDS = AD_LOADING_SECONDS + AD_VIEW_SECONDS; // 14s total
export const MAX_CONCURRENT_ADS = 3;
/** Hours before a liked link can reappear in the viewer's feed.
 *  Enforced in both the feed query (get_eligible_feed_links) and the
 *  like-commit guard (process_like_commit). */
export const LINK_COOLDOWN_HOURS = 12;

/** A profile row stripped of sensitive internal flags. Safe to expose to the
 *  owning user (and to client components). Internal flags like is_elite /
 *  is_boosted must never leak through this type. */
export type PublicProfile = {
  id: string;
  publicId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  role: Role;
  status: ProfileStatus;
  createdAt: string;
};

/** Full admin/super-admin representation of a profile. */
export type AdminProfile = PublicProfile & {
  isElite: boolean;
  isBoosted: boolean;
  boostOrder: number | null;
  boostModel: FeatureModel;
  boostExpiry: string | null;
  boostQuota: number | null;
  boostUsed: number;
  autoLikeEnabled: boolean;
  autoLikeModel: FeatureModel;
  autoLikePaused: boolean;
  autoLikeExpiry: string | null;
  autoLikeQuota: number | null;
  autoLikeUsed: number;
  freeAutoLikeUntil: string | null;
  boostedOfferCount: number;
  referredBy: string | null;
  approvedBy: string | null;
};
