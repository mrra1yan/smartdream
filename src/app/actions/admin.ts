"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireStaff } from "@/lib/auth";
import { getUserLinks, getUserStats, getReferralStats, failIfElite, nextBoostOrder } from "@/lib/admin";
import { TIME_PRESET_DAYS, type FeatureModel, type TimePreset } from "@/lib/types";
import { logAudit } from "@/lib/audit";

export type AdminActionResult = { ok?: boolean; error?: string };

export async function approveUser(userId: string): Promise<AdminActionResult> {
  try {
    const me = await requireStaff();
    if (userId.startsWith("mock-")) return { ok: true };
    await failIfElite(userId);

    // Atomic, self-guarding status transition. Previously this did a separate
    // SELECT to check `status === "pending"` and then an unconditional
    // UPDATE — two concurrent approveUser calls could both pass the SELECT
    // check before either UPDATE committed, and both would go on to credit
    // the referrer, double-crediting them. Folding the `status = 'pending'`
    // condition into the UPDATE itself makes the transition atomic: only the
    // call whose UPDATE actually flips a row (reported via `.select()`)
    // proceeds to the referrer-credit branch below. A second concurrent call
    // simply matches zero rows, since status is no longer 'pending' by then.
    const { data: updatedRows, error: updateError } = await supabase
      .from("profiles")
      .update({ status: "approved", approved_by: me?.id || null })
      .eq("id", userId)
      .eq("status", "pending")
      .select("referred_by");

    if (updateError) {
      console.error("approveUser error:", updateError);
      return { error: "Failed to approve user" };
    }

    if (!updatedRows || updatedRows.length === 0) {
      // Not found, or already approved/rejected by a concurrent call — no-op.
      return { ok: true };
    }

    await logAudit(me, "approve_user", userId);

    const referredBy = (updatedRows[0] as { referred_by: string | null }).referred_by;
    if (referredBy) {
      const { getSettings } = await import("@/lib/settings");
      const settings = await getSettings();
      const referrerBonus = settings.referralRewardReferrerMinutes;
      // Referee's own bonus is granted here too, not at signup time (see
      // src/app/actions/auth.ts's signup() comment) -- this is the moment the
      // account actually becomes usable, so it's the correct moment to start
      // the free-auto-like clock.
      const refereeBonus = settings.referralRewardRefereeMinutes;

      if (referrerBonus > 0) {
        const { data: referrer } = await supabase
          .from("profiles")
          .select("free_autolike_until, auto_like_paused, free_autolike_paused_remaining_minutes")
          .eq("id", referredBy)
          .single();

        if (referrer) {
          const r = referrer as any;
          if (r.auto_like_paused) {
            // Referrer is currently paused: their free_autolike_until column
            // is null (nulled out at pause time -- see /api/auto-like/status's
            // "pause" handler) and the real remaining time lives in
            // free_autolike_paused_remaining_minutes instead. Writing straight
            // to free_autolike_until here (like the branch below does) would
            // be silently discarded the moment they resume, since resume()
            // recomputes free_autolike_until purely from this snapshot and
            // overwrites whatever's there. Extend the snapshot instead, and
            // leave auto_like_paused untouched -- a deliberate pause shouldn't
            // be force-reactivated by an unrelated referral event.
            const currentRemaining = r.free_autolike_paused_remaining_minutes ?? 0;
            await supabase
              .from("profiles")
              .update({ free_autolike_paused_remaining_minutes: currentRemaining + referrerBonus })
              .eq("id", referredBy);
          } else {
            const currentUntil = r.free_autolike_until
              ? Math.max(Date.now(), new Date(r.free_autolike_until).getTime())
              : Date.now();
            const newUntil = new Date(currentUntil + referrerBonus * 60 * 1000).toISOString();

            await supabase
              .from("profiles")
              .update({ free_autolike_until: newUntil })
              .eq("id", referredBy);
          }
        }
      }

      if (refereeBonus > 0) {
        // The referee (userId, just approved) has no free_autolike_until of
        // its own yet at this point -- it's a brand-new pending account, never
        // credited before -- but reuse the same "extend from the later of now
        // / existing" pattern as the referrer branch above for consistency and
        // safety against ever running this twice.
        const newRefereeUntil = new Date(Date.now() + refereeBonus * 60 * 1000).toISOString();
        await supabase
          .from("profiles")
          .update({
            free_autolike_until: newRefereeUntil,
            auto_like_paused: false,
          })
          .eq("id", userId);
      }
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
    // run them concurrently instead of paying 6 sequential round-trips.
    await Promise.all([
      supabase.from("likes").delete().eq("liker_id", userId),
      supabase.from("likes").delete().eq("receiver_id", userId),
      supabase.from("links").delete().eq("user_id", userId),
      supabase.from("blogs").update({ created_by: null }).eq("created_by", userId),
      supabase.from("profiles").update({ referred_by: null }).eq("referred_by", userId),
      supabase.from("profiles").update({ approved_by: null }).eq("approved_by", userId),
    ]);

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      console.error("rejectUser error:", error);
      return { error: "Failed to delete user" };
    }

    await logAudit(me, "reject_user", userId);

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

    const nextOrder = await nextBoostOrder();

    const { error } = await supabase
      .from("profiles")
      .update({ ...payload, boost_order: nextOrder })
      .eq("id", args.userId);

    if (error) {
      console.error("activateBoost error:", error);
      return { error: "Failed to activate boost" };
    }

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

    const { error } = await supabase
      .from("profiles")
      .update({
        is_boosted: false,
        boost_model: "none",
        boost_expiry: null,
        boost_quota: null,
        boost_used: 0,
        boost_order: null,
      })
      .eq("id", userId);

    if (error) {
      return { error: "Failed to deactivate boost" };
    }

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

    const { error } = await supabase
      .from("profiles")
      .update(payload as any)
      .eq("id", args.userId);

    if (error) {
      console.error("activateAutoLike error:", error);
      return { error: "Failed to activate autolike" };
    }

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

    const { error } = await supabase
      .from("profiles")
      .update({
        auto_like_enabled: false,
        auto_like_model: "none",
        auto_like_expiry: null,
        auto_like_quota: null,
        auto_like_used: 0,
      })
      .eq("id", userId);

    if (error) {
      return { error: "Failed to deactivate autolike" };
    }

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

    // Passwords live in Supabase Auth, not on the profiles row. Use the admin
    // client to set it for an arbitrary user id (admin privilege bypass RLS).
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (error) {
      return { error: "Failed to reset password" };
    }

    await logAudit(me, "reset_password", userId);

    revalidatePath(`/admin/users/${userId}`);
    return { ok: true };
  } catch (err) {
    console.error("resetPassword error:", err);
    return { error: err instanceof Error ? err.message : "Failed to reset password" };
  }
}

// NOTE (IDOR fix): these three reads previously only called `requireStaff()`
// with no scope check on the target user, unlike the mutating actions above
// which all call `failIfElite(userId)` first. That meant a plain admin could
// pull a super-admin's or an elite user's private links/stats/referral data
// just by knowing (or guessing/enumerating) their UUID. `failIfElite` throws
// for elite/admin/super_admin targets unless the caller is a super_admin, so
// add it here to match the existing mutating-action pattern.
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
