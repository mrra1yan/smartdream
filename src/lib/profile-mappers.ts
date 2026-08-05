import type { ProfileRow } from "@/lib/repos/profiles";
import type { AdminProfile } from "@/lib/types";

/**
 * Map a profiles row (snake_case columns) to the app-facing `AdminProfile`
 * (camelCase). Database rows come back in snake_case; this is
 * the only correct way to bridge that to the UI types.
 *
 * Mirrors the field mapping in `getCurrentUser` (`src/lib/auth.ts`).
 */
export function profileRowToAdmin(row: ProfileRow): AdminProfile {
  return {
    id: row.id,
    publicId: row.public_id ?? "",
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    role: row.role as AdminProfile["role"],
    status: row.status as AdminProfile["status"],
    createdAt: row.created_at,
    isElite: Boolean(row.is_elite),
    isBoosted: Boolean(row.is_boosted),
    boostOrder: row.boost_order,
    boostModel: row.boost_model as AdminProfile["boostModel"],
    boostExpiry: row.boost_expiry,
    boostQuota: row.boost_quota,
    boostUsed: row.boost_used,
    autoLikeEnabled: Boolean(row.auto_like_enabled),
    autoLikeModel: row.auto_like_model as AdminProfile["autoLikeModel"],
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
