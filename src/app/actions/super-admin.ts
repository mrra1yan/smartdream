"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth";
import { getReferralStats } from "@/lib/admin";
import { logAudit } from "@/lib/audit";

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

function iso() {
  return new Date().toISOString();
}

async function failIfSuperAdmin(targetId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", targetId)
    .single();

  if (!data) throw new Error("User not found");
  if ((data as any).role === "super_admin") throw new Error("Cannot modify super_admin users");
}

export async function createEliteUser(args: CreateArgs) {
  const me = await requireSuperAdmin();
  const parsed = CreateUserSchema.safeParse(args);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { data: existingEmail } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", parsed.data.email)
    .single();

  if (existingEmail) return { error: "Email already exists." };

  const { data: existingPhone } = await supabase
    .from("profiles")
    .select("id")
    .eq("phone", parsed.data.phone)
    .single();

  if (existingPhone) return { error: "Phone number already exists." };

  // Create the auth user. The DB trigger auto-creates a `profiles` row with
  // status = 'pending' and role = 'user'; we then promote it to elite+approved.
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      phone: parsed.data.phone,
      role: "user",
      status: "approved",
    },
  });

  if (error || !data.user) {
    return { error: "Failed to create elite user" };
  }

  // Upgrade the auto-created profile to elite + approved.
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      public_id: generatePublicId(),
      is_elite: true,
      status: "approved",
      created_at: iso(),
    })
    .eq("id", data.user.id);

  if (profileError) {
    return { error: "Failed to create elite user" };
  }

  await logAudit(me, "create_elite_user", data.user.id, {
    email: parsed.data.email,
  });

  revalidatePath("/super-admin");
  revalidatePath("/super-admin/elite");
  return { ok: true };
}

export async function deleteEliteUser(userId: string): Promise<SuperResult> {
  try {
    const me = await requireSuperAdmin();
    await failIfSuperAdmin(userId);

    await supabase.from("likes").delete().eq("liker_id", userId);
    await supabase.from("likes").delete().eq("receiver_id", userId);
    await supabase.from("links").delete().eq("user_id", userId);
    await supabase.from("blogs").update({ created_by: null }).eq("created_by", userId);
    await supabase.from("profiles").update({ referred_by: null }).eq("referred_by", userId);
    await supabase.from("profiles").update({ approved_by: null }).eq("approved_by", userId);

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      return { error: "Failed to delete elite user" };
    }

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

    // Passwords live in Supabase Auth. Use the admin client to set it.
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password,
    });

    if (error) {
      return { error: "Failed to reset password" };
    }

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

    const { error } = await supabase
      .from("profiles")
      .update({ role: "admin", status: "approved" })
      .eq("id", userId);

    if (error) {
      return { error: "Failed to promote user" };
    }

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

    const { error } = await supabase
      .from("profiles")
      .update({ role: "user" })
      .eq("id", userId);

    if (error) {
      return { error: "Failed to demote admin" };
    }

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
  const me = await requireSuperAdmin();
  const parsed = CreateUserSchema.safeParse(args);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { data: existingEmail } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", parsed.data.email)
    .single();

  if (existingEmail) return { error: "Email already exists." };

  const { data: existingPhone } = await supabase
    .from("profiles")
    .select("id")
    .eq("phone", parsed.data.phone)
    .single();

  if (existingPhone) return { error: "Phone number already exists." };

  // Create the auth user. The DB trigger auto-creates a `profiles` row; we
  // then promote it to role = admin, status = approved.
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      phone: parsed.data.phone,
      role: "admin",
      status: "approved",
    },
  });

  if (error || !data.user) {
    return { error: "Failed to create admin" };
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      public_id: generatePublicId(),
      role: "admin",
      status: "approved",
      created_at: iso(),
    })
    .eq("id", data.user.id);

  if (profileError) {
    return { error: "Failed to create admin" };
  }

  await logAudit(me, "create_admin", data.user.id, { email: parsed.data.email });

  revalidatePath("/super-admin");
  revalidatePath("/super-admin/admins");
  return { ok: true };
}

// NOTE: settings.elite_weight (the value this writes) is not currently read
// by the feed ranking -- elite links are an unconditional priority tier, not
// a weighted one (see the comment on `combined` in src/lib/feed.ts). No UI
// currently calls this action; kept as a working, permission-gated write
// path in case elite ranking becomes weight-based again in the future.
export async function setEliteWeight(value: number): Promise<SuperResult> {
  const me = await requireSuperAdmin();
  if (!Number.isFinite(value) || value < 0 || value > 1000) {
    return { error: "elite_weight must be between 0 and 1000." };
  }

  const { error } = await supabase
    .from("settings")
    .update({ elite_weight: Math.round(value), updated_at: iso() })
    .eq("id", "1");

  if (error) {
    return { error: "Failed to update elite weight" };
  }

  await logAudit(me, "set_elite_weight", null, { value: Math.round(value) });

  revalidatePath("/super-admin/settings");
  return { ok: true };
}

export type LevelReferralSettingsArgs = {
  referralRewardReferrerMinutes: number;
  referralRewardRefereeMinutes: number;
};

// Mirrors setEliteWeight's bounds-checking pattern. Cap chosen as a generous
// but sane upper bound for a "minutes of free auto-like" reward: 525,600
// minutes == 1 non-leap year. Anything beyond that is almost certainly a
// fat-fingered input (e.g. entering seconds/hours by mistake) rather than an
// intended setting.
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

  // NOTE: the `settings` table columns are snake_case
  // (referral_reward_referrer_minutes / referral_reward_referee_minutes,
  // see `Settings` in @/lib/supabase); previously this spread the camelCase
  // `args` object straight into `.update()`, which silently targeted
  // nonexistent columns and always failed. Map explicitly instead.
  const { error } = await supabase
    .from("settings")
    .update({
      referral_reward_referrer_minutes: Math.round(referralRewardReferrerMinutes),
      referral_reward_referee_minutes: Math.round(referralRewardRefereeMinutes),
      updated_at: iso(),
    })
    .eq("id", "1");

  if (error) {
    return { error: "Failed to update referral settings" };
  }

  await logAudit(me, "set_level_referral_settings", null, {
    referral_reward_referrer_minutes: Math.round(referralRewardReferrerMinutes),
    referral_reward_referee_minutes: Math.round(referralRewardRefereeMinutes),
  });

  revalidatePath("/super-admin/settings");
  return { ok: true };
}

export async function getUserReferralStats(userId: string) {
  await requireSuperAdmin();
  return await getReferralStats(userId);
}
