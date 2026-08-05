"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { ROLE_HOME } from "@/lib/routes";
import { getI18n } from "@/lib/i18n";
import { checkRateLimit } from "@/lib/rate-limit";
import type { Role } from "@/lib/types";
import {
  findProfileByEmail,
  findProfileByPhone,
  findProfileByPublicId,
  getLoginProfile,
  insertProfile,
  type ProfileRow,
} from "@/lib/repos/profiles";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  signSession,
} from "@/lib/session-cookie";

const BCRYPT_ROUNDS = 10;

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

    // Check duplicate email and phone (friendly error before hashing).
    const [existingEmail, existingPhone] = await Promise.all([
      findProfileByEmail(parsed.data.email),
      findProfileByPhone(parsed.data.phone),
    ]);

    if (existingEmail) {
      console.error("[SIGNUP_DEBUG] Email already exists: [redacted]");
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
      console.error("[SIGNUP_DEBUG] Phone already exists: [redacted]");
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

    // Resolve the referrer (if any) so it can be recorded on the new profile.
    // The referee's own bonus is intentionally NOT granted here — see the
    // comment history in the old Supabase version: it's granted in
    // approveUser() (src/app/actions/admin.ts) instead, where the reward is
    // actually usable.
    let referredById: string | null = null;

    if (parsed.data.referralCode) {
      const code = parsed.data.referralCode.trim();
      if (code) {
        const referrer = await findProfileByPublicId(code);
        if (referrer) {
          referredById = referrer.id;
        }
      }
    }

    const id = globalThis.crypto.randomUUID();
    const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);
    const publicId = generatePublicId();

    // One INSERT — the old auth trigger (handle_new_user) is gone; the app
    // owns both the profile row and the password hash now.
    await insertProfile({
      id,
      public_id: publicId,
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      phone: parsed.data.phone,
      email: parsed.data.email,
      password_hash: passwordHash,
      role: "user",
      status: "pending",
      referred_by: referredById,
    });

    return {
      pending: true,
      name: `${parsed.data.firstName} ${parsed.data.lastName}`,
      publicId,
    };
  } catch (err) {
    if (err instanceof Error && (err as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) {
      throw err;
    }

    // The pre-INSERT duplicate checks above are a TOCTOU race window: two
    // concurrent signups can both pass `findProfileByEmail`/`findProfileByPhone`
    // and race into insertProfile(). The schema's UNIQUE constraints on
	    // phone_key (0001) and email_key (0004) are the real backstop — catch
	    // PostgreSQL UNIQUE violation (23505) here and surface a friendly message matching
    // whichever key collided, instead of a generic "unexpected error".
    const dbErr = err as { errno?: number; code?: string; constraint?: string; detail?: string; sqlMessage?: string };
    // PostgreSQL unique violation: code 23505
    // MySQL unique violation (legacy): errno 1062 / code ER_DUP_ENTRY
    if (dbErr.code === "23505" || dbErr.errno === 1062 || dbErr.code === "ER_DUP_ENTRY") {
      const msg = String(dbErr.detail ?? dbErr.constraint ?? dbErr.sqlMessage ?? "");
      const values = {
        firstName: String(formData.get("firstName") ?? ""),
        lastName: String(formData.get("lastName") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        email: String(formData.get("email") ?? ""),
        referralCode: String(formData.get("referralCode") ?? ""),
      };
      if (msg.includes("email")) {
        console.error("[SIGNUP] Race-condition duplicate email caught at DB: [redacted]");
        return { message: t("auth.errorEmailExists"), values };
      }
      if (msg.includes("phone")) {
        console.error("[SIGNUP] Race-condition duplicate phone caught at DB: [redacted]");
        return {
          message: t("auth.errorPhoneExists") || "Phone number already exists.",
          values,
        };
      }
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

    // Resolve the profile by email OR phone (two separate parameterized
    // lookups — the old filter-injection note in the Supabase version: never
    // interpolate user input into an OR filter).
    const profile: ProfileRow | null = await getLoginProfile(identifier);
    if (!profile) {
      console.log("[LOGIN] Profile not found for identifier:", identifier.slice(0, 3) + "***");
      return { message: t("auth.errorInvalidCredentials") };
    }

    // Role gate BEFORE verifying the password (same generic message as a bad
    // password — the old login-portal oracle protection).
    // super_admin can also log in through the admin login portal.
    const roleOk =
      (profile.role as Role) === expectedRole ||
      (expectedRole === "admin" && (profile.role as Role) === "super_admin");
    if (!roleOk) {
      console.log("[LOGIN] Role mismatch — profile role:", profile.role, "expected:", expectedRole);
      return { message: t("auth.errorInvalidCredentials") };
    }

    // Verify the bcrypt hash (was signInWithPassword against Supabase Auth).
    const valid = profile.password_hash
      ? await bcrypt.compare(password, profile.password_hash)
      : false;
    if (!valid) {
      console.log("[LOGIN] Password check failed for:", identifier.slice(0, 3) + "***");
      return { message: t("auth.errorInvalidCredentials") };
    }

    if (profile.status === "pending") {
      return { pending: true, name: `${profile.first_name ?? ""} ${profile.last_name ?? ""}`, publicId: profile.public_id ?? undefined };
    }
    if (profile.status !== "approved") {
      return { message: t("auth.errorRejected") };
    }

    // Issue the session JWT cookie.
    const token = await signSession({
      sub: profile.id,
      role: profile.role as Role,
      status: profile.status as "pending" | "approved" | "rejected",
    });
    const store = await cookies();
    store.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());

    console.log("[LOGIN] Redirecting to:", ROLE_HOME[profile.role] ?? "/");
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
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}
