"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireSuperAdmin } from "@/lib/auth";
import { getReferralStats } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { invalidateSettingsCache } from "@/lib/settings";
import {
  deleteProfile,
  findProfileByEmail,
  findProfileByPhone,
  getProfileMeta,
  insertProfile,
  nullOutApprovedBy,
  nullOutReferredBy,
  updateProfile,
} from "@/lib/repos/profiles";
import { deleteLikesByLiker, deleteLikesByReceiver } from "@/lib/repos/likes";
import { deleteLinksByUser } from "@/lib/repos/links";
import { nullOutBlogCreator } from "@/lib/repos/blogs";
import { updateSettingsRow } from "@/lib/repos/settings";
import { invalidateProfileCache } from "@/lib/profile-cache";

export type SuperResult = { ok?: boolean; error?: string };

const CreateUserSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  phone: z.string().min(5).max(20),
  email: z.string().email().max(255),
  password: z.string().min(8).max(100),
});

type CreateArgs = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  password: string;
};

function generatePublicId() {
  const array = new Uint32Array(1);
  globalThis.crypto.getRandomValues(array);
  const min = 10000000;
  const max = 99999999;
  const range = max - min + 1;
  const rand = min + (array[0] % range);
  return String(rand);
}

async function failIfSuperAdmin(targetId: string) {
  const meta = await getProfileMeta(targetId);
  if (!meta) throw new Error("User not found");
  if (meta.role === "super_admin") throw new Error("Cannot modify super_admin users");
}

/** Shared create-user path (was auth.admin.createUser + trigger + promote —
 *  now a single INSERT with the bcrypt hash, since profiles IS the user). */
async function createUserInternal(
  args: CreateArgs,
  opts: { role: "user" | "admin"; isElite: boolean; action: string },
): Promise<SuperResult> {
  const me = await requireSuperAdmin();
  const parsed = CreateUserSchema.safeParse(args);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [existingEmail, existingPhone] = await Promise.all([
    findProfileByEmail(parsed.data.email),
    findProfileByPhone(parsed.data.phone),
  ]);

  if (existingEmail) return { error: "Email already exists." };
  if (existingPhone) return { error: "Phone number already exists." };

  const id = globalThis.crypto.randomUUID();
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  try {
    await insertProfile({
      id,
      public_id: generatePublicId(),
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      phone: parsed.data.phone,
      email: parsed.data.email,
      password_hash: passwordHash,
      role: opts.role,
      status: "approved",
    });
    if (opts.isElite) {
      await updateProfile(id, { is_elite: true });
    }
  } catch (err) {
    console.error("createUserInternal error:", err);
    return { error: "Failed to create user" };
  }

  await logAudit(me, opts.action, id, { email: parsed.data.email });
  return { ok: true, _userId: id } as unknown as SuperResult;
}

export async function createEliteUser(args: CreateArgs) {
  const result = await createUserInternal(args, {
    role: "user",
    isElite: true,
    action: "create_elite_user",
  });
  if (!result.ok) return result;
  revalidatePath("/super-admin");
  revalidatePath("/super-admin/elite");
  return { ok: true };
}

export async function deleteEliteUser(userId: string): Promise<SuperResult> {
  try {
    const me = await requireSuperAdmin();
    await failIfSuperAdmin(userId);

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

    await deleteProfile(userId);
    await invalidateProfileCache(userId);

    await logAudit(me, "delete_elite_user", userId);

    revalidatePath("/super-admin");
    revalidatePath("/super-admin/elite");
    return { ok: true };
  } catch (err) {
    console.error("deleteEliteUser error:", err);
    return { error: err instanceof Error ? err.message : "Failed to delete elite user" };
  }
}

export async function resetElitePassword(userId: string, password: string): Promise<SuperResult> {
  try {
    const me = await requireSuperAdmin();
    await failIfSuperAdmin(userId);
    if (password.length < 8) return { error: "Password must be at least 8 characters." };

    // Passwords now live on the profiles row (bcrypt hash).
    const hash = await bcrypt.hash(password, 10);
    await updateProfile(userId, { password_hash: hash });
    await invalidateProfileCache(userId);

    await logAudit(me, "reset_elite_password", userId);

    return { ok: true };
  } catch (err) {
    console.error("resetElitePassword error:", err);
    return { error: err instanceof Error ? err.message : "Failed to reset password" };
  }
}

export async function promoteToAdmin(userId: string): Promise<SuperResult> {
  try {
    const me = await requireSuperAdmin();
    await failIfSuperAdmin(userId);

    await updateProfile(userId, { role: "admin", status: "approved" });
    await invalidateProfileCache(userId);

    await logAudit(me, "promote_to_admin", userId, { new_role: "admin" });

    revalidatePath("/super-admin");
    revalidatePath("/super-admin/admins");
    return { ok: true };
  } catch (err) {
    console.error("promoteToAdmin error:", err);
    return { error: err instanceof Error ? err.message : "Failed to promote user" };
  }
}

export async function demoteAdmin(userId: string): Promise<SuperResult> {
  try {
    const me = await requireSuperAdmin();
    await failIfSuperAdmin(userId);

    await updateProfile(userId, { role: "user" });
    await invalidateProfileCache(userId);

    await logAudit(me, "demote_admin", userId, { old_role: "admin", new_role: "user" });

    revalidatePath("/super-admin");
    revalidatePath("/super-admin/admins");
    return { ok: true };
  } catch (err) {
    console.error("demoteAdmin error:", err);
    return { error: err instanceof Error ? err.message : "Failed to demote admin" };
  }
}

export async function createAdmin(args: CreateArgs) {
  const result = await createUserInternal(args, {
    role: "admin",
    isElite: false,
    action: "create_admin",
  });
  if (!result.ok) return result;
  revalidatePath("/super-admin");
  revalidatePath("/super-admin/admins");
  return { ok: true };
}

// NOTE: settings.elite_weight is not currently read by the feed ranking —
// elite links are an unconditional priority tier, not a weighted one. No UI
// currently calls this action; kept as a working, permission-gated write path.
export async function setEliteWeight(value: number): Promise<SuperResult> {
  const me = await requireSuperAdmin();
  if (!Number.isFinite(value) || value < 0 || value > 1000) {
    return { error: "elite_weight must be between 0 and 1000." };
  }

  try {
    await updateSettingsRow({ elite_weight: Math.round(value) });
  } catch (err) {
    console.error("setEliteWeight error:", err);
    return { error: "Failed to update elite weight" };
  }

  await logAudit(me, "set_elite_weight", null, { value: Math.round(value) });
  await invalidateSettingsCache();

  revalidatePath("/super-admin/settings");
  return { ok: true };
}

export type LevelReferralSettingsArgs = {
  referralRewardReferrerMinutes: number;
  referralRewardRefereeMinutes: number;
};

const MAX_REFERRAL_REWARD_MINUTES = 525_600;

export async function setLevelReferralSettings(args: LevelReferralSettingsArgs): Promise<SuperResult> {
  const me = await requireSuperAdmin();

  const { referralRewardReferrerMinutes, referralRewardRefereeMinutes } = args;

  if (
    !Number.isFinite(referralRewardReferrerMinutes) ||
    referralRewardReferrerMinutes < 0 ||
    referralRewardReferrerMinutes > MAX_REFERRAL_REWARD_MINUTES
  ) {
    return { error: `referralRewardReferrerMinutes must be between 0 and ${MAX_REFERRAL_REWARD_MINUTES}.` };
  }
  if (
    !Number.isFinite(referralRewardRefereeMinutes) ||
    referralRewardRefereeMinutes < 0 ||
    referralRewardRefereeMinutes > MAX_REFERRAL_REWARD_MINUTES
  ) {
    return { error: `referralRewardRefereeMinutes must be between 0 and ${MAX_REFERRAL_REWARD_MINUTES}.` };
  }

  try {
    await updateSettingsRow({
      referral_reward_referrer_minutes: Math.round(referralRewardReferrerMinutes),
      referral_reward_referee_minutes: Math.round(referralRewardRefereeMinutes),
    });
  } catch (err) {
    console.error("setLevelReferralSettings error:", err);
    return { error: "Failed to update referral settings" };
  }

  await logAudit(me, "set_level_referral_settings", null, {
    referral_reward_referrer_minutes: Math.round(referralRewardReferrerMinutes),
    referral_reward_referee_minutes: Math.round(referralRewardRefereeMinutes),
  });
  await invalidateSettingsCache();

  revalidatePath("/super-admin/settings");
  return { ok: true };
}

export async function getUserReferralStats(userId: string) {
  await requireSuperAdmin();
  return await getReferralStats(userId);
}
