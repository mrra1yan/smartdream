"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { requireStaff } from "@/lib/auth";
import { getUserLinks, getUserStats, getReferralStats, failIfElite, nextBoostOrder } from "@/lib/admin";
import { TIME_PRESET_DAYS, type FeatureModel, type TimePreset } from "@/lib/types";
import { logAudit } from "@/lib/audit";
import {
  approveProfileAtomic,
  deleteProfile,
  getProfileBonusFields,
  nullOutApprovedBy,
  nullOutReferredBy,
  updateProfile,
} from "@/lib/repos/profiles";
import { deleteLikesByLiker, deleteLikesByReceiver } from "@/lib/repos/likes";
import { deleteLinksByUser } from "@/lib/repos/links";
import { nullOutBlogCreator } from "@/lib/repos/blogs";
import { invalidateProfileCache } from "@/lib/profile-cache";

export type AdminActionResult = { ok?: boolean; error?: string };

export async function approveUser(userId: string): Promise<AdminActionResult> {
  try {
    const me = await requireStaff();
    if (userId.startsWith("mock-")) return { ok: true };
    await failIfElite(userId);

    // Atomic, self-guarding status transition: the UPDATE only flips a row
    // while status is still 'pending', so a second concurrent approveUser
    // matches zero rows and cannot double-credit the referrer.
    const referredBy = await approveProfileAtomic(userId, me?.id || null);
    if (referredBy === null) {
      // Not found, or already approved/rejected by a concurrent call — no-op.
      return { ok: true };
    }

    await logAudit(me, "approve_user", userId);

    // Referrer's own bonus + the referee's (brand-new account) bonus. The
    // referee's clock starts here — the moment the account becomes usable —
    // not at signup (see src/app/actions/auth.ts signup() comment).
    const { getSettings } = await import("@/lib/settings");
    const settings = await getSettings();
    const referrerBonus = settings.referralRewardReferrerMinutes;
    const refereeBonus = settings.referralRewardRefereeMinutes;

    if (referrerBonus > 0) {
      const referrer = await getProfileBonusFields(referredBy);
      if (referrer) {
        if (referrer.auto_like_paused) {
          // Referrer is paused: their free_autolike_until is null (nulled at
          // pause time) and the real remaining time lives in
          // free_autolike_paused_remaining_minutes. Extend the snapshot —
          // writing to free_autolike_until would be discarded on resume.
          const currentRemaining = referrer.free_autolike_paused_remaining_minutes ?? 0;
          await updateProfile(referredBy, {
            free_autolike_paused_remaining_minutes: currentRemaining + referrerBonus,
          });
        } else {
          const currentUntil = referrer.free_autolike_until
            ? Math.max(Date.now(), new Date(referrer.free_autolike_until).getTime())
            : Date.now();
          const newUntil = new Date(currentUntil + referrerBonus * 60 * 1000).toISOString();
          await updateProfile(referredBy, { free_autolike_until: newUntil });
        }
        await invalidateProfileCache(referredBy);
      }
    }

    if (refereeBonus > 0) {
      const newRefereeUntil = new Date(Date.now() + refereeBonus * 60 * 1000).toISOString();
      await updateProfile(userId, {
        free_autolike_until: newRefereeUntil,
        auto_like_paused: false,
      });
      await invalidateProfileCache(userId);
    }

    revalidatePath("/admin");
    revalidatePath(`/admin/users/${userId}`);
    return { ok: true };
  } catch (err) {
    console.error("approveUser error:", err);
    return { error: err instanceof Error ? err.message : "Failed to approve user" };
  }
}

export async function rejectUser(userId: string): Promise<AdminActionResult> {
  try {
    const me = await requireStaff();
    if (userId.startsWith("mock-")) return { ok: true };
    await failIfElite(userId);

    // None of these 6 cleanup statements depend on each other's results, so
    // run them concurrently.
    await Promise.all([
      deleteLikesByLiker(userId),
      deleteLikesByReceiver(userId),
      deleteLinksByUser(userId),
      nullOutBlogCreator(userId),
      nullOutReferredBy(userId),
      nullOutApprovedBy(userId),
    ]);

    // Was Supabase Auth's auth.admin.deleteUser — now the profiles row IS the
    // user (single table), so hard-delete it. Likes/links cascade.
    await deleteProfile(userId);

    await logAudit(me, "reject_user", userId);
    await invalidateProfileCache(userId);

    revalidatePath("/admin");
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (err) {
    console.error("rejectUser error:", err);
    return { error: err instanceof Error ? err.message : "Failed to delete user" };
  }
}

export async function removeUser(userId: string) {
  return rejectUser(userId);
}

type ActivateArgs = {
  userId: string;
  model: FeatureModel;
  preset?: TimePreset;
  quota?: number;
};

function computePayload(
  feature: "boost" | "autolike",
  { model, preset, quota }: ActivateArgs,
) {
  if (feature === "boost") {
    if (model === "no_expiry") {
      return { is_boosted: true, boost_model: "no_expiry", boost_expiry: null, boost_quota: null, boost_used: 0 };
    }
    if (model === "time" && preset) {
      const days = TIME_PRESET_DAYS[preset];
      return {
        is_boosted: true, boost_model: "time",
        boost_expiry: new Date(Date.now() + days * 86400000).toISOString(),
        boost_quota: null, boost_used: 0,
      };
    }
    if (model === "usage" && quota && quota > 0) {
      return { is_boosted: true, boost_model: "usage", boost_expiry: null, boost_quota: quota, boost_used: 0 };
    }
    throw new Error("Invalid activation parameters.");
  }
  const unpauseFields = { auto_like_paused: false, auto_like_paused_remaining_minutes: null, free_autolike_paused_remaining_minutes: null };
  if (model === "no_expiry") {
    return { ...unpauseFields, auto_like_enabled: true, auto_like_model: "no_expiry", auto_like_expiry: null, auto_like_quota: null, auto_like_used: 0 };
  }
  if (model === "time" && preset) {
    const days = TIME_PRESET_DAYS[preset];
    return {
      ...unpauseFields,
      auto_like_enabled: true, auto_like_model: "time",
      auto_like_expiry: new Date(Date.now() + days * 86400000).toISOString(),
      auto_like_quota: null, auto_like_used: 0,
    };
  }
  if (model === "usage" && quota && quota > 0) {
    return { ...unpauseFields, auto_like_enabled: true, auto_like_model: "usage", auto_like_expiry: null, auto_like_quota: quota, auto_like_used: 0 };
  }
  throw new Error("Invalid activation parameters.");
}

export async function activateBoost(args: ActivateArgs): Promise<AdminActionResult> {
  try {
    const me = await requireStaff();
    if (args.userId.startsWith("mock-")) return { ok: true };
    await failIfElite(args.userId);
    const payload = computePayload("boost", args);

    const boostOrder = await nextBoostOrder();
    await updateProfile(args.userId, { ...payload, boost_order: boostOrder });
    await invalidateProfileCache(args.userId);

    await logAudit(me, "activate_boost", args.userId, { model: args.model, preset: args.preset, quota: args.quota });

    revalidatePath(`/admin/users/${args.userId}`);
    revalidatePath("/admin/users/[id]", "page");
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (err) {
    console.error("activateBoost error:", err);
    return { error: err instanceof Error ? err.message : "Failed to activate boost" };
  }
}

export async function deactivateBoost(userId: string): Promise<AdminActionResult> {
  try {
    const me = await requireStaff();
    if (userId.startsWith("mock-")) return { ok: true };
    await failIfElite(userId);

    await updateProfile(userId, {
      is_boosted: false,
      boost_model: "none",
      boost_expiry: null,
      boost_quota: null,
      boost_used: 0,
      boost_order: null,
    });
    await invalidateProfileCache(userId);

    await logAudit(me, "deactivate_boost", userId);

    revalidatePath(`/admin/users/${userId}`);
    revalidatePath("/admin/users/[id]", "page");
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to deactivate boost" };
  }
}

export async function activateAutoLike(args: ActivateArgs): Promise<AdminActionResult> {
  try {
    const me = await requireStaff();
    if (args.userId.startsWith("mock-")) return { ok: true };
    await failIfElite(args.userId);
    const payload = computePayload("autolike", args);

    await updateProfile(args.userId, payload);
    await invalidateProfileCache(args.userId);

    await logAudit(me, "activate_autolike", args.userId, { model: args.model, preset: args.preset, quota: args.quota });

    revalidatePath(`/admin/users/${args.userId}`);
    revalidatePath("/admin/users/[id]", "page");
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (err) {
    console.error("activateAutoLike error:", err);
    return { error: err instanceof Error ? err.message : "Failed to activate autolike" };
  }
}

export async function deactivateAutoLike(userId: string): Promise<AdminActionResult> {
  try {
    const me = await requireStaff();
    if (userId.startsWith("mock-")) return { ok: true };
    await failIfElite(userId);

    await updateProfile(userId, {
      auto_like_enabled: false,
      auto_like_model: "none",
      auto_like_expiry: null,
      auto_like_quota: null,
      auto_like_used: 0,
    });
    await invalidateProfileCache(userId);

    await logAudit(me, "deactivate_autolike", userId);

    revalidatePath(`/admin/users/${userId}`);
    revalidatePath("/admin/users/[id]", "page");
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to deactivate autolike" };
  }
}

export async function resetPassword(userId: string, newPassword: string): Promise<AdminActionResult> {
  try {
    const me = await requireStaff();
    if (userId.startsWith("mock-")) return { ok: true };
    await failIfElite(userId);
    if (newPassword.length < 8) return { error: "Password must be at least 8 characters." };

    // Passwords now live on the profiles row (bcrypt hash) — was
    // auth.admin.updateUserById.
    const hash = await bcrypt.hash(newPassword, 10);
    await updateProfile(userId, { password_hash: hash });
    await invalidateProfileCache(userId);

    await logAudit(me, "reset_password", userId);

    revalidatePath(`/admin/users/${userId}`);
    return { ok: true };
  } catch (err) {
    console.error("resetPassword error:", err);
    return { error: err instanceof Error ? err.message : "Failed to reset password" };
  }
}

// NOTE (IDOR fix): these three reads only called `requireStaff()` with no
// scope check on the target user, unlike the mutating actions above which all
// call `failIfElite(userId)` first — a plain admin could otherwise pull a
// super-admin's or elite user's private data by guessing their UUID.
export async function getSelectedUserLinks(userId: string) {
  await requireStaff();
  await failIfElite(userId);
  return await getUserLinks(userId);
}

export async function getSelectedUserStats(userId: string) {
  await requireStaff();
  await failIfElite(userId);
  return await getUserStats(userId);
}

export async function getSelectedUserReferrals(userId: string) {
  await requireStaff();
  await failIfElite(userId);
  return await getReferralStats(userId);
}
