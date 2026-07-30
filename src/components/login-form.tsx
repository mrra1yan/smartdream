"use client";

import { useActionState, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Mail, Lock, Loader2, AlertTriangle } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import { PendingPopup } from "@/components/pending-popup";
import { useI18n } from "@/components/i18n-provider";
import type { Role } from "@/lib/types";
import { AuthField, inputClass } from "@/components/auth-field";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { StaggerContainer, StaggerItem } from "@/components/ui/motion-wrapper";

type LoginState = { message?: string; pending?: boolean; name?: string; publicId?: string } | undefined;

/** Seconds before we consider a server action permanently stuck (network error, CORS rejection, etc.). */
const LOGIN_TIMEOUT_SECONDS = 15;

export function LoginForm({
  role: _role,
  whatsappNumber,
  action,
  href,
  isPending,
}: {
  role: Role;
  whatsappNumber?: string;
  action: (state: LoginState, formData: FormData) => Promise<LoginState>;
  href?: { signup?: string; alt?: { label: string; href: string }[] };
  isPending?: boolean;
}) {
  const { t } = useI18n();

  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    action,
    undefined,
  );

  // Detect when a server action gets permanently stuck (network error, CORS
  // rejection, etc.) and surface a visible error instead of spinning forever.
  const [submitTimedOut, setSubmitTimedOut] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pending) {
      setSubmitTimedOut(false);
      timeoutRef.current = setTimeout(() => {
        setSubmitTimedOut(true);
      }, LOGIN_TIMEOUT_SECONDS * 1000);
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [pending]);

  useEffect(() => {
    if (state?.message) {
      toast.error(state.message);
    }
  }, [state?.message]);

  if (state?.pending || isPending) {
    return (
      <PendingPopup
        whatsappNumber={whatsappNumber}
        name={state?.name}
        id={state?.publicId}
        onClose={() => {
          window.location.href = "/login";
        }}
      />
    );
  }

  return (
    <form action={formAction}>
      <StaggerContainer className="flex flex-col gap-5">
        {/* Email or Phone */}
        <StaggerItem>
          <AuthField
            id="identifier"
            label={t("auth.identifier")}
            icon={<Mail size={15} />}
          >
            <input
              id="identifier"
              name="identifier"
              type="text"
              autoComplete="username"
              placeholder={t("auth.identifierPlaceholder")}
              className={inputClass}
            />
          </AuthField>
        </StaggerItem>

        {/* Password */}
        <StaggerItem>
          <AuthField
            id="password"
            label={t("auth.password")}
            icon={<Lock size={15} />}
          >
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              placeholder={t("auth.passwordPlaceholder")}
              className="pl-10"
            />
          </AuthField>
        </StaggerItem>

        {/* Submit */}
        <StaggerItem>
          {submitTimedOut && pending && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400 mb-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{t("auth.errorTimeout") || "Request timed out. Please check your connection and try again."}</span>
            </div>
          )}
          <motion.button
            type="submit"
            disabled={pending && !submitTimedOut}
            whileHover={{ scale: 1.015 }}
            whileTap={{ scale: 0.985 }}
            className="w-full h-12 rounded-xl bg-gradient-to-r from-accent via-indigo-500 to-purple-600 text-white font-semibold text-sm shadow-md shadow-accent/20 hover:shadow-lg hover:shadow-accent/30 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2.5"
          >
            {pending && !submitTimedOut ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading")}
              </>
            ) : (
              t("auth.loginCta")
            )}
          </motion.button>
        </StaggerItem>

        {/* Links */}
        {href && (
          <StaggerItem>
            <div className="flex flex-col items-center gap-3 pt-1">
              {href.signup && (
                <div className="flex w-full items-center gap-2">
                  <div className="h-px flex-1 bg-border/40" />
                  <Link
                    href={href.signup}
                    className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold text-muted-foreground border border-border/30 hover:border-accent/45 hover:text-accent hover:bg-accent/5 transition-all duration-300 whitespace-nowrap"
                  >
                    {t("auth.noAccount").replace("?", "")} · {t("auth.signup")}
                  </Link>
                  <div className="h-px flex-1 bg-border/40" />
                </div>
              )}
              {href.alt?.map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                >
                  {a.label}
                </Link>
              ))}
            </div>
          </StaggerItem>
        )}
      </StaggerContainer>
    </form>
  );
}


