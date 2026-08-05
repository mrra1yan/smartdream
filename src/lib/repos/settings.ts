import "server-only";
import { pool, toIso } from "@/lib/db";

/** settings table repository (single row, id = '1'). */

export type SettingsRow = {
  id: string;
  whatsapp_number: string | null;
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
  level1_name: string | null;
  level1_threshold: number | null;
  level2_name: string | null;
  level2_threshold: number | null;
  level3_name: string | null;
  level3_threshold: number | null;
  level4_name: string | null;
  level4_threshold: number | null;
  created_at: string;
  updated_at: string;
};

export function mapSettingsRow(row: Record<string, unknown>): SettingsRow {
  const num = (v: unknown, fallback: number): number =>
    v == null ? fallback : Number(v);
  return {
    id: String(row.id),
    whatsapp_number: (row.whatsapp_number as string | null) ?? null,
    active_like_count: num(row.active_like_count, 0),
    active_window_hours: num(row.active_window_hours, 24),
    elite_weight: num(row.elite_weight, 50),
    offer_likes_required: num(row.offer_likes_required, 100),
    offer_autolike_minutes: num(row.offer_autolike_minutes, 60),
    offer_active: row.offer_active as boolean,
    boost_price_no_expiry: row.boost_price_no_expiry == null ? null : Number(row.boost_price_no_expiry),
    boost_price_1w: row.boost_price_1w == null ? null : Number(row.boost_price_1w),
    boost_price_1m: row.boost_price_1m == null ? null : Number(row.boost_price_1m),
    boost_price_3m: row.boost_price_3m == null ? null : Number(row.boost_price_3m),
    boost_price_6m: row.boost_price_6m == null ? null : Number(row.boost_price_6m),
    boost_price_1y: row.boost_price_1y == null ? null : Number(row.boost_price_1y),
    boost_price_usage_per_unit: row.boost_price_usage_per_unit == null ? null : Number(row.boost_price_usage_per_unit),
    autolike_price_no_expiry: row.autolike_price_no_expiry == null ? null : Number(row.autolike_price_no_expiry),
    autolike_price_1w: row.autolike_price_1w == null ? null : Number(row.autolike_price_1w),
    autolike_price_1m: row.autolike_price_1m == null ? null : Number(row.autolike_price_1m),
    autolike_price_3m: row.autolike_price_3m == null ? null : Number(row.autolike_price_3m),
    autolike_price_6m: row.autolike_price_6m == null ? null : Number(row.autolike_price_6m),
    autolike_price_1y: row.autolike_price_1y == null ? null : Number(row.autolike_price_1y),
    autolike_price_usage_per_unit: row.autolike_price_usage_per_unit == null ? null : Number(row.autolike_price_usage_per_unit),
    referral_reward_referrer_minutes: num(row.referral_reward_referrer_minutes, 1440),
    referral_reward_referee_minutes: num(row.referral_reward_referee_minutes, 720),
    level1_name: (row.level1_name as string | null) ?? null,
    level1_threshold: row.level1_threshold == null ? null : Number(row.level1_threshold),
    level2_name: (row.level2_name as string | null) ?? null,
    level2_threshold: row.level2_threshold == null ? null : Number(row.level2_threshold),
    level3_name: (row.level3_name as string | null) ?? null,
    level3_threshold: row.level3_threshold == null ? null : Number(row.level3_threshold),
    level4_name: (row.level4_name as string | null) ?? null,
    level4_threshold: row.level4_threshold == null ? null : Number(row.level4_threshold),
    created_at: toIso(row.created_at) ?? "",
    updated_at: toIso(row.updated_at) ?? "",
  };
}

export async function getSettingsRow(): Promise<SettingsRow | null> {
  const { rows } = await pool.query("SELECT * FROM settings WHERE id = '1' LIMIT 1");
  return rows[0] ? mapSettingsRow(rows[0]) : null;
}

/** Whitelisted settings columns. */
const SETTINGS_COLS: Record<string, string> = {
  whatsapp_number: "whatsapp_number",
  active_like_count: "active_like_count",
  active_window_hours: "active_window_hours",
  elite_weight: "elite_weight",
  offer_likes_required: "offer_likes_required",
  offer_autolike_minutes: "offer_autolike_minutes",
  offer_active: "offer_active",
  boost_price_no_expiry: "boost_price_no_expiry",
  boost_price_1w: "boost_price_1w",
  boost_price_1m: "boost_price_1m",
  boost_price_3m: "boost_price_3m",
  boost_price_6m: "boost_price_6m",
  boost_price_1y: "boost_price_1y",
  boost_price_usage_per_unit: "boost_price_usage_per_unit",
  autolike_price_no_expiry: "autolike_price_no_expiry",
  autolike_price_1w: "autolike_price_1w",
  autolike_price_1m: "autolike_price_1m",
  autolike_price_3m: "autolike_price_3m",
  autolike_price_6m: "autolike_price_6m",
  autolike_price_1y: "autolike_price_1y",
  autolike_price_usage_per_unit: "autolike_price_usage_per_unit",
  referral_reward_referrer_minutes: "referral_reward_referrer_minutes",
  referral_reward_referee_minutes: "referral_reward_referee_minutes",
  level1_name: "level1_name",
  level1_threshold: "level1_threshold",
  level2_name: "level2_name",
  level2_threshold: "level2_threshold",
  level3_name: "level3_name",
  level3_threshold: "level3_threshold",
  level4_name: "level4_name",
  level4_threshold: "level4_threshold",
};

export async function updateSettingsRow(
  patch: Partial<Record<string, unknown>>,
): Promise<void> {
  const entries = Object.entries(patch).filter(([key]) => key in SETTINGS_COLS);
  if (entries.length === 0) return;
  const sets = entries.map(([key], i) => `${SETTINGS_COLS[key]} = $${i + 1}`);
  const values = entries.map(([, value]) => value ?? null);
  await pool.query(`UPDATE settings SET ${sets.join(", ")} WHERE id = '1'`, values);
}
