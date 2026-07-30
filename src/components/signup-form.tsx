"use client";

import { useActionState, useState, useEffect } from "react";
import Link from "next/link";
import { User, Phone, Mail, Lock, Loader2, Check, ShieldCheck } from "lucide-react";
import { type AuthFormState } from "@/app/actions/auth";
import { PasswordInput } from "@/components/ui/password-input";
import { PendingPopup } from "@/components/pending-popup";
import { useI18n } from "@/components/i18n-provider";
import { AuthField, inputClass } from "@/components/auth-field";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { StaggerContainer, StaggerItem } from "@/components/ui/motion-wrapper";

export function SignupForm({
  whatsappNumber,
  referralCode,
  action,
}: {
  whatsappNumber?: string;
  referralCode?: string;
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
}) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    action,
    undefined,
  );
  const [terms, setTerms] = useState(false);

  useEffect(() => {
	    if (state) {
	      if (process.env.NODE_ENV === "development") {
	        console.log("[SIGNUP_DEBUG] Form state updated:", state);
	      }
	    }
    if (state?.message) {
      toast.error(state.message);
    }
  }, [state]);

  if (state?.pending) {
    return <PendingPopup whatsappNumber={whatsappNumber} name={state.name} id={state.publicId} />;
  }

  return (
    <form action={formAction}>
      <StaggerContainer className="flex flex-col gap-4">
        {/* Row 1 — First name & Last name */}
        <StaggerItem>
          <div className="grid grid-cols-2 gap-4">
            <AuthField
              id="firstName"
              label={t("auth.firstName")}
              icon={<User size={14} />}
              error={state?.errors?.firstName?.[0]}
            >
              <input key={state?.values?.firstName || "fn"} id="firstName" name="firstName" defaultValue={state?.values?.firstName} autoComplete="given-name" placeholder={t("auth.firstNamePlaceholder")} className={inputClass} />
            </AuthField>
            <AuthField
              id="lastName"
              label={t("auth.lastName")}
              icon={<User size={14} />}
              error={state?.errors?.lastName?.[0]}
            >
              <input key={state?.values?.lastName || "ln"} id="lastName" name="lastName" defaultValue={state?.values?.lastName} autoComplete="family-name" placeholder={t("auth.lastNamePlaceholder")} className={inputClass} />
            </AuthField>
          </div>
        </StaggerItem>

        {/* Row 2 — Email & Phone */}
        <StaggerItem>
          <div className="grid grid-cols-1 gap-4">
            <AuthField
              id="email"
              label={t("auth.email")}
              icon={<Mail size={14} />}
              error={state?.errors?.email?.[0]}
            >
              <input key={state?.values?.email || "email"} id="email" name="email" type="email" defaultValue={state?.values?.email} autoComplete="email" placeholder={t("auth.emailPlaceholder")} className={inputClass} />
            </AuthField>
            <AuthField
              id="phone"
              label={t("auth.phone")}
              icon={<Phone size={14} />}
              error={state?.errors?.phone?.[0]}
            >
              <input
                key={state?.values?.phone || "phone"}
                id="phone"
                name="phone"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="tel"
                defaultValue={state?.values?.phone}
                placeholder={t("auth.phonePlaceholder")}
                className={inputClass}
                onKeyPress={(e) => {
                  if (!/[0-9]/.test(e.key)) {
                    e.preventDefault();
                  }
                }}
                onChange={(e) => {
                  e.target.value = e.target.value.replace(/[^0-9]/g, "");
                }}
              />
            </AuthField>
          </div>
        </StaggerItem>

        {/* Row 3 — Password & Confirm password */}
        <StaggerItem>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <AuthField
              id="password"
              label={t("auth.password")}
              icon={<Lock size={14} />}
              error={state?.errors?.password?.[0]}
            >
              <PasswordInput id="password" name="password" autoComplete="new-password" placeholder={t("auth.passwordMinPlaceholder")} className="pl-10" />
            </AuthField>
            <AuthField
              id="confirmPassword"
              label={t("auth.confirmPassword")}
              icon={<Lock size={14} />}
              error={state?.errors?.confirmPassword?.[0]}
            >
              <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" placeholder={t("auth.repeatPasswordPlaceholder")} className="pl-10" />
            </AuthField>
          </div>
        </StaggerItem>

        {/* Row 4 — Referral Code */}
        <StaggerItem>
          <AuthField
            id="referralCode"
            label={t("auth.referralCodeOptional")}
            icon={<User size={14} />}
          >
            <input key={state?.values?.referralCode ?? referralCode ?? "ref"} id="referralCode" name="referralCode" defaultValue={state?.values?.referralCode ?? referralCode} placeholder={t("auth.enterFriendId")} className={inputClass} />
          </AuthField>
        </StaggerItem>

        {/* Terms acceptance */}
        <StaggerItem>
          <div>
            <button
              type="button"
              role="checkbox"
              aria-checked={terms}
              onClick={() => setTerms((v) => !v)}
              className={[
                "group w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-300",
                terms
                  ? "border-accent/65 bg-accent/8 shadow-sm shadow-accent/10"
                  : "border-border/40 bg-surface/80 hover:border-accent/30 hover:bg-accent/4",
              ].join(" ")}
            >
              {/* Custom checkbox */}
              <div className={[
                "flex-shrink-0 flex h-4 w-4 items-center justify-center rounded-md border-2 transition-all duration-200",
                terms
                  ? "border-accent bg-accent shadow-sm shadow-accent/30 scale-105"
                  : "border-border/60 bg-background group-hover:border-accent/50",
              ].join(" ")}>
                {terms && <Check size={10} className="text-white" strokeWidth={3} />}
              </div>

              {/* Text */}
              <span className="text-xs sm:text-sm text-muted-foreground leading-snug">
                {t("auth.termsAcceptLabel")}{" "}
                <Link
                  href="/terms"
                  onClick={(e) => e.stopPropagation()}
                  className="font-semibold text-accent hover:underline underline-offset-2"
                >
                  {t("auth.termsLink")}
                </Link>
              </span>

              {/* Shield icon when checked */}
              {terms && (
                <ShieldCheck size={16} className="ml-auto flex-shrink-0 text-accent animate-pulse" />
              )}
            </button>

            {/* Hidden checkbox for form submission */}
            <input type="checkbox" name="terms" value="on" checked={terms} onChange={() => {}} className="sr-only" aria-hidden="true" />

            {state?.errors?.terms && (
              <p className="mt-1.5 text-[11px] font-semibold text-danger">{state.errors.terms[0]}</p>
            )}
          </div>
        </StaggerItem>

        {/* Submit */}
        <StaggerItem>
          <motion.button
            type="submit"
            disabled={pending}
            whileHover={{ scale: 1.015 }}
            whileTap={{ scale: 0.985 }}
            className="w-full h-12 rounded-xl bg-gradient-to-r from-accent via-indigo-500 to-purple-600 text-white font-semibold text-sm shadow-md shadow-accent/20 hover:shadow-lg hover:shadow-accent/30 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2.5"
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading")}
              </>
            ) : (
              t("auth.signupCta")
            )}
          </motion.button>
        </StaggerItem>

        {/* Back to login */}
        <StaggerItem>
          <div className="flex items-center justify-center gap-2 pt-1">
            <div className="h-px flex-1 bg-border/40" />
            <Link
              href="/login"
              className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold text-muted-foreground border border-border/30 hover:border-accent/45 hover:text-accent hover:bg-accent/5 transition-all duration-305 whitespace-nowrap"
            >
              {t("auth.haveAccount").replace("?", "")} · {t("auth.login")}
            </Link>
            <div className="h-px flex-1 bg-border/40" />
          </div>
        </StaggerItem>
      </StaggerContainer>
    </form>
  );
}
