"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { getCurrentUser } from "@/lib/auth";
import {
  findProfileByPhone,
  getProfile,
  updateProfile as repoUpdateProfile,
} from "@/lib/repos/profiles";
import { invalidateProfileCache, invalidateProfileLookups } from "@/lib/profile-cache";

export type ProfileFormState =
  | {
      errors?: {
        firstName?: string[];
        lastName?: string[];
        phone?: string[];
      };
      message?: string;
      ok?: boolean;
    }
  | undefined;

const ProfileSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(50).trim(),
  lastName: z.string().min(1, "Last name is required").max(50).trim(),
  phone: z.string().min(5, "Phone number must be at least 5 characters").max(20).trim(),
});

export async function updateProfile(_state: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const user = await getCurrentUser();
  if (!user) return { message: "Not authenticated." };

  const parsed = ProfileSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    phone: formData.get("phone"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  // Friendly early-exit for the common case; the unique index on the phone
  // generated column (profiles.phone_key) is the authoritative guard — a
  // concurrent duplicate fails the UPDATE below with ER_DUP_ENTRY (1062).
  const existingPhone = await findProfileByPhone(parsed.data.phone);
  if (existingPhone && existingPhone.id !== user.id) {
    return { errors: { phone: ["Phone number already in use."] } };
  }

  try {
    await repoUpdateProfile(user.id, {
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      phone: parsed.data.phone,
    });
  } catch (err) {
    if ((err as { errno?: number })?.errno === 1062) {
      return { errors: { phone: ["Phone number already in use."] } };
    }
    console.error("updateProfile error:", err);
    return { message: "Failed to update profile" };
  }

  // Invalidate the 60s profile cache + login lookups (old phone → this user).
  await invalidateProfileCache(user.id);
  await invalidateProfileLookups([user.phone, parsed.data.phone]);

  revalidatePath("/profile");
  return { ok: true };
}

export type PasswordFormState =
  | {
      errors?: {
        currentPassword?: string[];
        newPassword?: string[];
        confirmPassword?: string[];
      };
      message?: string;
      ok?: boolean;
    }
  | undefined;

const PasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required").max(100),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(100)
      .regex(/[a-zA-Z]/, "Password must contain at least one letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
    confirmPassword: z.string().max(100),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export async function changePassword(_state: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const user = await getCurrentUser();
  if (!user) return { message: "Not authenticated." };

  const parsed = PasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  // Re-authenticate against the stored bcrypt hash (was signInWithPassword).
  const profile = await getProfile(user.id);
  if (!profile?.password_hash || !(await bcrypt.compare(parsed.data.currentPassword, profile.password_hash))) {
    return { errors: { currentPassword: ["Incorrect current password."] } };
  }

  const newHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await repoUpdateProfile(user.id, { password_hash: newHash });

  // Force the cached profile row to refresh so the UI reflects the change.
  await invalidateProfileCache(user.id);

  return { ok: true };
}
