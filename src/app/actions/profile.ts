"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

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

  // Fast, friendly early-exit for the common case. Not the authoritative
  // guard on its own — two concurrent updates with the same phone could both
  // pass this check before either UPDATE commits. The partial unique index
  // on profiles.phone (supabase/migrations/0006_low_severity_races.sql) is
  // what actually closes that race; a duplicate that slips past this check
  // fails the update below with a real unique-violation, caught next.
  const { data: existingPhone } = await supabase
    .from("profiles")
    .select("id")
    .eq("phone", parsed.data.phone)
    .single();

  if (existingPhone && existingPhone.id !== user.id) {
    return { errors: { phone: ["Phone number already in use."] } };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      phone: parsed.data.phone,
    })
    .eq("id", user.id);

  if (error) {
    if (error.code === "23505") {
      return { errors: { phone: ["Phone number already in use."] } };
    }
    return { message: "Failed to update profile" };
  }

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

  // Verify the current password by re-authenticating against Supabase Auth.
  // This preserves the original UX where the user must prove they know their
  // current password before changing it.
  const adminClient = await createSupabaseServerClient();
  const { error: verifyError } = await adminClient.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });

  if (verifyError) {
    return { errors: { currentPassword: ["Incorrect current password."] } };
  }

  // Update the password on the signed-in user's session.
  const { error } = await adminClient.auth.updateUser({
    password: parsed.data.newPassword,
  });

  if (error) {
    return { message: "Failed to change password" };
  }

  return { ok: true };
}
