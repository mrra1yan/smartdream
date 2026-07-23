import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { LoginForm } from "@/components/login-form";
import { login } from "@/app/actions/auth";
import * as React from "react";
import { GlassCard } from "@/components/glass-card";
import { AuthHero } from "@/components/auth-hero";

export const metadata: Metadata = { title: "Super admin log in | Smart Dream" };

export default async function SuperAdminLoginPage() {
  const { t } = await getI18n();
  const settings = await getSettings();
  const loginAction = login.bind(null, "super_admin");

  return (
    <div className="flex flex-col gap-4">
      <AuthHero
        title={t("auth.superAdminLogin")}
        subtitle={t("auth.superAdminLoginSubtitle")}
      />
      
      <GlassCard>
        <LoginForm role="super_admin" whatsappNumber={settings.whatsappNumber} action={loginAction} />
      </GlassCard>
    </div>
  );
}
