"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { requireStaff } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const nullableNumber = z.preprocess(
  (val) => (val === "" || val === null || val === undefined ? null : val),
  z.coerce.number().min(0).nullable().optional()
);

const SettingsSchema = z.object({
  whatsappNumber: z.string().max(30).optional(),
  activeLikeCount: z.coerce.number().int().min(1).max(1000).optional(),
  activeWindowHours: z.coerce.number().int().min(1).max(720).optional(),
  offerLikesRequired: z.coerce.number().int().min(1).max(1000).optional(),
  offerAutoLikeMinutes: z.coerce.number().int().min(1).max(10080).optional(),
  offerActive: z.boolean().optional(),
  boostPriceNoExpiry: nullableNumber,
  boostPrice1w: nullableNumber,
  boostPrice1m: nullableNumber,
  boostPrice3m: nullableNumber,
  boostPrice6m: nullableNumber,
  boostPrice1y: nullableNumber,
  boostPriceUsagePerUnit: nullableNumber,
  autolikePriceNoExpiry: nullableNumber,
  autolikePrice1w: nullableNumber,
  autolikePrice1m: nullableNumber,
  autolikePrice3m: nullableNumber,
  autolikePrice6m: nullableNumber,
  autolikePrice1y: nullableNumber,
  autolikePriceUsagePerUnit: nullableNumber,
  // referralRewardReferrerMinutes / referralRewardRefereeMinutes intentionally
  // omitted: these are super-admin-only fields (see
  // `setLevelReferralSettings` in `@/app/actions/super-admin.ts`) and must
  // not be settable by a plain admin through this staff-gated action.
});

export type SettingsFormState = { error?: string; ok?: boolean } | undefined;

export async function updateSettings(
  _state: SettingsFormState,
  formData: FormData,
) {
  const me = await requireStaff();
  const parsed = SettingsSchema.safeParse({
    whatsappNumber: formData.get("whatsappNumber"),
    activeLikeCount: formData.get("activeLikeCount"),
    activeWindowHours: formData.get("activeWindowHours"),
    offerLikesRequired: formData.get("offerLikesRequired"),
    offerAutoLikeMinutes: formData.get("offerAutoLikeMinutes"),
    offerActive: formData.get("offerActive") === "on",
    boostPriceNoExpiry: formData.get("boostPriceNoExpiry"),
    boostPrice1w: formData.get("boostPrice1w"),
    boostPrice1m: formData.get("boostPrice1m"),
    boostPrice3m: formData.get("boostPrice3m"),
    boostPrice6m: formData.get("boostPrice6m"),
    boostPrice1y: formData.get("boostPrice1y"),
    boostPriceUsagePerUnit: formData.get("boostPriceUsagePerUnit"),
    autolikePriceNoExpiry: formData.get("autolikePriceNoExpiry"),
    autolikePrice1w: formData.get("autolikePrice1w"),
    autolikePrice1m: formData.get("autolikePrice1m"),
    autolikePrice3m: formData.get("autolikePrice3m"),
    autolikePrice6m: formData.get("autolikePrice6m"),
    autolikePrice1y: formData.get("autolikePrice1y"),
    autolikePriceUsagePerUnit: formData.get("autolikePriceUsagePerUnit"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("settings")
    .update({
      whatsapp_number: parsed.data.whatsappNumber,
      active_like_count: parsed.data.activeLikeCount,
      active_window_hours: parsed.data.activeWindowHours,
      offer_likes_required: parsed.data.offerLikesRequired,
      offer_autolike_minutes: parsed.data.offerAutoLikeMinutes,
      offer_active: parsed.data.offerActive,
      boost_price_no_expiry: parsed.data.boostPriceNoExpiry,
      boost_price_1w: parsed.data.boostPrice1w,
      boost_price_1m: parsed.data.boostPrice1m,
      boost_price_3m: parsed.data.boostPrice3m,
      boost_price_6m: parsed.data.boostPrice6m,
      boost_price_1y: parsed.data.boostPrice1y,
      boost_price_usage_per_unit: parsed.data.boostPriceUsagePerUnit,
      autolike_price_no_expiry: parsed.data.autolikePriceNoExpiry,
      autolike_price_1w: parsed.data.autolikePrice1w,
      autolike_price_1m: parsed.data.autolikePrice1m,
      autolike_price_3m: parsed.data.autolikePrice3m,
      autolike_price_6m: parsed.data.autolikePrice6m,
      autolike_price_1y: parsed.data.autolikePrice1y,
      autolike_price_usage_per_unit: parsed.data.autolikePriceUsagePerUnit,
      updated_at: now,
    })
    .eq("id", "1");

  if (error) {
    return { error: "Failed to update settings" };
  }

  await logAudit(me, "update_settings", null);

  revalidatePath("/admin/settings");
  revalidatePath("/");
  revalidatePath("/boosted");
  revalidatePath("/premium");
  return { ok: true };
}
