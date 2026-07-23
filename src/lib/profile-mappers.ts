import type { Profile } from "@/lib/supabase";
import type { AdminProfile } from "@/lib/types";

/**
 * Map a Supabase `profiles` row (snake_case columns) to the app-facing
 * `AdminProfile` (camelCase). Supabase returns rows in the database's
 * snake_case; this is the only correct way to bridge that to the UI types.
 *
 * Mirrors the field mapping in `getCurrentUser` (`src/lib/auth.ts`).
 */
export function profileRowToAdmin(row: Profile): AdminProfile {
  return {
    id: row.id,
    publicId: row.public_id,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    isElite: Boolean(row.is_elite),
    isBoosted: Boolean(row.is_boosted),
    boostOrder: row.boost_order,
    boostModel: row.boost_model,
    boostExpiry: row.boost_expiry,
    boostQuota: row.boost_quota,
    boostUsed: row.boost_used,
    autoLikeEnabled: Boolean(row.auto_like_enabled),
    autoLikeModel: row.auto_like_model,
    autoLikePaused: Boolean(row.auto_like_paused),
    autoLikeExpiry: row.auto_like_expiry,
    autoLikeQuota: row.auto_like_quota,
    autoLikeUsed: row.auto_like_used,
    freeAutoLikeUntil: row.free_autolike_until,
    boostedOfferCount: row.boosted_offer_count,
    referredBy: row.referred_by,
    approvedBy: row.approved_by,
  };
}
