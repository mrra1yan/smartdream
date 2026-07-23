"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Lock, CheckCircle } from "lucide-react";
import { type PasswordFormState } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { useI18n } from "@/components/i18n-provider";
import { motion } from "framer-motion";
import { toast } from "sonner";

export function ChangePasswordForm({
  action,
}: {
  action: (state: PasswordFormState, formData: FormData) => Promise<PasswordFormState>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, formAction, pending] = useActionState<PasswordFormState, FormData>(
    action,
    undefined,
  );

  useEffect(() => {
    if (state?.message) {
      toast.error(state.message);
    }
  }, [state?.message]);

  useEffect(() => {
    if (state?.ok) {
      // Redirect back to profile page after short delay
      const timer = setTimeout(() => {
        router.push("/profile");
        router.refresh();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [state?.ok, router]);

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Back Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/50 bg-surface/60 text-muted-foreground hover:text-foreground transition-all cursor-pointer shadow-sm mt-1"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="space-y-3">
          <h1 className="text-2xl font-black text-foreground bg-gradient-to-r from-accent via-purple-500 to-indigo-600 bg-clip-text text-transparent">
            {t("profile.changePassword")}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground/90">{t("profile.changePasswordDescription")}</p>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl border border-border/50 bg-surface/60 p-6 shadow-xl relative overflow-hidden"
      >
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-accent/10 blur-xl" />

        {state?.ok ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center py-10 gap-3 text-center"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20 text-green-500 border border-green-500/20">
              <CheckCircle className="h-6 w-6 animate-pulse" />
            </div>
            <p className="text-sm font-bold text-green-500">
              {t("profile.passwordSuccess")}
            </p>
            <p className="text-xs text-muted">{t("profile.redirecting")}</p>
          </motion.div>
        ) : (
          <form action={formAction} className="space-y-4">
            {/* Current Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted" htmlFor="currentPassword">
                {t("profile.currentPasswordLabel")}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 z-10">
                  <Lock className="h-4 w-4" />
                </span>
                <PasswordInput
                  id="currentPassword"
                  name="currentPassword"
                  placeholder={t("profile.currentPasswordPlaceholder")}
                  className="pl-10 h-11"
                  disabled={pending}
                  hasError={!!state?.errors?.currentPassword}
                />
              </div>
              {state?.errors?.currentPassword && (
                <p className="text-[11px] text-danger">{state.errors.currentPassword[0]}</p>
              )}
            </div>

            {/* New Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted" htmlFor="newPassword">
                {t("profile.newPasswordLabel")}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 z-10">
                  <Lock className="h-4 w-4" />
                </span>
                <PasswordInput
                  id="newPassword"
                  name="newPassword"
                  placeholder={t("profile.newPasswordPlaceholder")}
                  className="pl-10 h-11"
                  disabled={pending}
                  hasError={!!state?.errors?.newPassword}
                />
              </div>
              {state?.errors?.newPassword && (
                <p className="text-[11px] text-danger">{state.errors.newPassword[0]}</p>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted" htmlFor="confirmPassword">
                {t("profile.confirmPasswordLabel")}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 z-10">
                  <Lock className="h-4 w-4" />
                </span>
                <PasswordInput
                  id="confirmPassword"
                  name="confirmPassword"
                  placeholder={t("profile.confirmPasswordPlaceholder")}
                  className="pl-10 h-11"
                  disabled={pending}
                  hasError={!!state?.errors?.confirmPassword}
                />
              </div>
              {state?.errors?.confirmPassword && (
                <p className="text-[11px] text-danger">{state.errors.confirmPassword[0]}</p>
              )}
            </div>

            <div className="pt-2 flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                disabled={pending}
                className="rounded-2xl h-11 cursor-pointer"
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={pending} className="rounded-2xl h-11 px-6 cursor-pointer">
                {pending ? t("common.loading") : t("common.save")}
              </Button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
}
