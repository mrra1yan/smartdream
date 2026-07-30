import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n";
import { LoginForm } from "@/components/login-form";
import { login } from "@/app/actions/auth";
import * as React from "react";
import { GlassCard } from "@/components/glass-card";
import { AuthHero } from "@/components/auth-hero";

export const metadata: Metadata = { title: "Admin log in | Smart Dream" };

export default async function AdminLoginPage() {
  const { t } = await getI18n();
  const loginAction = login.bind(null, "admin");

  return (
    <div className="flex flex-col gap-4">
      <AuthHero
        title={t("auth.adminLogin")}
        subtitle={t("auth.adminLoginSubtitle")}
      />
      
      <GlassCard>
        <LoginForm role="admin" action={loginAction} />
      </GlassCard>
    </div>
  );
}
