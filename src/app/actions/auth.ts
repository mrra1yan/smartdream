"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ROLE_HOME } from "@/lib/routes";
import { getI18n } from "@/lib/i18n";
import { checkRateLimit } from "@/lib/rate-limit";
import type { Role } from "@/lib/types";

export type AuthFormState =
  | {
      errors?: {
        firstName?: string[];
        lastName?: string[];
        phone?: string[];
        email?: string[];
        password?: string[];
        confirmPassword?: string[];
        terms?: string[];
      };
      message?: string;
      pending?: boolean;
      name?: string;
      publicId?: string;
      values?: {
        firstName?: string;
        lastName?: string;
        phone?: string;
        email?: string;
        referralCode?: string;
      };
    }
  | undefined;

export type LoginState = { message?: string; pending?: boolean; name?: string; publicId?: string } | undefined;

function generatePublicId(): string {
  const array = new Uint32Array(1);
  globalThis.crypto.getRandomValues(array);
  const min = 10000000;
  const max = 99999999;
  const range = max - min + 1;
  const rand = min + (array[0] % range);
  return String(rand);
}

export async function signup(_state: AuthFormState, formData: FormData) {
  const { t } = await getI18n();
  try {
    const allowed = await checkRateLimit("signup");
    if (!allowed) {
      return { message: t("auth.errorTooManyRequests") || "Too many attempts. Please try again later." };
    }

    const SignupSchema = z.object({
      firstName: z.string().min(1, { message: t("auth.errorFirstNameRequired") || "First name is required" }).max(50).trim(),
      lastName: z.string().min(1, { message: t("auth.errorLastNameRequired") || "Last name is required" }).max(50).trim(),
      phone: z.string().min(5, { message: t("auth.errorPhoneInvalid") || "Phone number is invalid" }).max(20).regex(/^[0-9]+$/, { message: t("auth.errorPhoneOnlyNumbers") || "Phone number must contain only numbers" }).trim(),
      email: z.string().email({ message: t("auth.errorEmailInvalid") || "Invalid email address" }).max(255).trim(),
      password: z.string()
        .min(6, { message: t("auth.errorPasswordMin") || "Password must be at least 6 characters long" })
        .max(100),
      confirmPassword: z.string().max(100),
      terms: z.union([z.literal("on"), z.literal("true"), z.literal("1")]).optional(),
      referralCode: z.string().max(50).optional(),
    }).refine((d) => d.password === d.confirmPassword, {
      message: t("auth.errorPasswordMismatch") || "Passwords do not match",
      path: ["confirmPassword"]
    });

    const rawTerms = formData.get("terms");
    const parsed = SignupSchema.safeParse({
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      phone: formData.get("phone"),
      email: formData.get("email"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
      terms: rawTerms === "on" || rawTerms === "true" || rawTerms === "1" ? "on" : undefined,
      referralCode: formData.get("referralCode") || undefined,
    });

    if (!parsed.success) {
      console.error("[SIGNUP_DEBUG] Validation failed:", parsed.error.flatten().fieldErrors);
      return {
        errors: parsed.error.flatten().fieldErrors,
        values: {
          firstName: String(formData.get("firstName") ?? ""),
          lastName: String(formData.get("lastName") ?? ""),
          phone: String(formData.get("phone") ?? ""),
          email: String(formData.get("email") ?? ""),
          referralCode: String(formData.get("referralCode") ?? ""),
        }
      };
    }

    if (!parsed.data.terms) {
      console.error("[SIGNUP_DEBUG] Terms not accepted");
      return {
        errors: { terms: [t("auth.errorTermsRequired")] },
        values: {
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          phone: parsed.data.phone,
          email: parsed.data.email,
          referralCode: parsed.data.referralCode,
        }
      };
    }

    // Check duplicate email and phone (friendly error before hitting
    // Supabase Auth) -- independent lookups, run in parallel instead of
    // paying two sequential round-trips.
    const [{ data: existingEmail }, { data: existingPhone }] = await Promise.all([
      supabase.from("profiles").select("id").eq("email", parsed.data.email).single(),
      supabase.from("profiles").select("id").eq("phone", parsed.data.phone).single(),
    ]);

    if (existingEmail) {
      console.error("[SIGNUP_DEBUG] Email already exists:", parsed.data.email);
      return {
        message: t("auth.errorEmailExists"),
        values: {
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          phone: parsed.data.phone,
          email: parsed.data.email,
          referralCode: parsed.data.referralCode,
        }
      };
    }

    if (existingPhone) {
      console.error("[SIGNUP_DEBUG] Phone already exists:", parsed.data.phone);
      return {
        message: t("auth.errorPhoneExists") || "Phone number already exists.",
        values: {
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          phone: parsed.data.phone,
          email: parsed.data.email,
          referralCode: parsed.data.referralCode,
        }
      };
    }

    // Resolve the referrer (if any) so we can record it on the new profile.
    // The trigger creates the profile, but it does not know about referrals,
    // so we patch it in afterwards. The referee's own bonus is intentionally
    // NOT granted here -- it used to be (free_autolike_until set at signup
    // time, same as this referredById patch), but a brand-new account is
    // `status: "pending"` and cannot use auto-like until an admin approves
    // it, which can take anywhere from minutes to days. Starting the bonus
    // clock at signup meant a slow approval could burn through the entire
    // reward before the referee ever got a chance to use it. Granting it in
    // approveUser() (src/app/actions/admin.ts) instead -- the same place the
    // referrer's own bonus is granted -- starts the clock when the reward is
    // actually usable.
    let referredById: string | null = null;

    if (parsed.data.referralCode) {
      const code = parsed.data.referralCode.trim();
      if (code) {
        const { data: referrer } = await supabase
          .from("profiles")
          .select("id")
          .eq("public_id", code)
          .single();

        if (referrer) {
          referredById = (referrer as { id: string }).id;
        }
      }
    }

    const serverClient = await createSupabaseServerClient();

    // Create the auth user. The DB trigger auto-creates the `profiles` row
    // with status = 'pending' from this metadata. Email confirmation must be
    // disabled in Supabase so the user is immediately usable.
    const { data: signUpData, error: signUpError } = await serverClient.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: {
          first_name: parsed.data.firstName,
          last_name: parsed.data.lastName,
          phone: parsed.data.phone,
          role: "user",
          status: "pending",
        },
      },
    });

    if (signUpError) {
      console.error("[SIGNUP_DEBUG] Supabase signUp error:", signUpError);
      return { message: signUpError.message || t("auth.errorUnexpected") || "An unexpected error occurred. Please try again." };
    }

    const newUserId = signUpData.user?.id;
    if (newUserId) {
      // Patch referral fields + ensure the public_id is set. The trigger
      // generates a public_id, but we also fall back to generating one here
      // in case the trigger's column differs from the historical format.
      const publicId = generatePublicId();
      await supabase
        .from("profiles")
        .update({
          public_id: publicId,
          referred_by: referredById,
        })
        .eq("id", newUserId);

      return {
        pending: true,
        name: `${parsed.data.firstName} ${parsed.data.lastName}`,
        publicId,
      };
    }

    return { pending: true, name: `${parsed.data.firstName} ${parsed.data.lastName}` };
  } catch (err) {
    if (err instanceof Error && (err as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) {
      throw err;
    }
    console.error("[SIGNUP] Unexpected error:", err);
    return { message: t("auth.errorUnexpected") || "An unexpected error occurred. Please try again." };
  }
}

export async function login(
  expectedRole: Role,
  _state: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const { t } = await getI18n();
  try {
    const identifier = String(formData.get("identifier") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    const allowed = await checkRateLimit("login", identifier);
    if (!allowed) {
      return { message: t("auth.errorTooManyRequests") || "Too many attempts. Please try again later." };
    }

    // Resolve the profile first. Login is email-only now (Supabase Auth), but
    // the form historically accepts an email-or-phone identifier, so we look
    // the profile up by either and use its email to sign in with Supabase.
    //
    // IMPORTANT: this is two separate, parameterized `.eq()` lookups rather
    // than a single `.or()` filter built from raw user input. Interpolating
    // `identifier` into a `.or(\`email.eq.${identifier},...\`)` string lets a
    // value like `x,role.eq.super_admin` be parsed as additional PostgREST
    // filter syntax instead of a literal value — since this query runs on the
    // service-role client (RLS bypassed), that could let an attacker match an
    // arbitrary row (e.g. the super-admin's) without knowing its email/phone.
    let profile: any = null;
    if (identifier) {
      const { data: byEmail } = await supabase
        .from("profiles")
        .select("*")
        .eq("email", identifier)
        .maybeSingle();
      profile = byEmail;

      if (!profile) {
        const { data: byPhone } = await supabase
          .from("profiles")
          .select("*")
          .eq("phone", identifier)
          .maybeSingle();
        profile = byPhone;
      }
    }

    if (!profile) {
      return { message: t("auth.errorInvalidCredentials") };
    }

    // Check the role gate BEFORE verifying the password (and reuse the exact
    // same generic message as a bad password). Checking this after
    // `signInWithPassword` would mean a correct password on the wrong portal
    // returns a different error ("wrong role") than a wrong password
    // ("invalid credentials"), turning any login portal into an oracle that
    // validates password guesses and leaks the target account's role.
    if ((profile.role as Role) !== expectedRole) {
      return { message: t("auth.errorInvalidCredentials") };
    }

    const serverClient = await createSupabaseServerClient();

    // Authenticate against Supabase Auth using the resolved email.
    const { error: signInError } = await serverClient.auth.signInWithPassword({
      email: profile.email,
      password,
    });

    if (signInError) {
      return { message: t("auth.errorInvalidCredentials") };
    }

    if (profile.status === "pending") {
      return { pending: true, name: `${profile.first_name} ${profile.last_name}`, publicId: profile.public_id };
    }
    if (profile.status !== "approved") {
      await serverClient.auth.signOut();
      return { message: t("auth.errorRejected") };
    }

    redirect(ROLE_HOME[profile.role] ?? "/");
  } catch (err) {
    if (err instanceof Error && (err as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) {
      throw err;
    }
    console.error("[LOGIN] Unexpected error:", err);
    return { message: t("auth.errorUnexpected") };
  }
}

export async function logout() {
  const serverClient = await createSupabaseServerClient();
  await serverClient.auth.signOut();
  redirect("/login");
}
