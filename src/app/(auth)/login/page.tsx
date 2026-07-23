import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { LoginForm } from "@/components/login-form";
import { login } from "@/app/actions/auth";
import { GlassCard } from "@/components/glass-card";
import { AuthHero } from "@/components/auth-hero";

export const metadata: Metadata = { title: "Log in | Smart Dream" };

export default async function LoginPage(props: {
  searchParams: Promise<{ pending?: string }>;
}) {
  const searchParams = await props.searchParams;
  const isPending = searchParams.pending === "1";
  const { t } = await getI18n();
  const settings = await getSettings();
  const loginAction = login.bind(null, "user");

  return (
    <div className="flex flex-col gap-4">

      {/* ── Compact hero ─────────────────────────────────────────── */}
      <AuthHero title={t("auth.welcomeBack")} subtitle={t("auth.loginSubtitle")} />

      {/* ── Glass card ────────────────────────────────────────────── */}
      <GlassCard>
        <LoginForm
          role="user"
          whatsappNumber={settings.whatsappNumber}
          action={loginAction}
          href={{ signup: "/signup" }}
          isPending={isPending}
        />
      </GlassCard>

    </div>
  );
}
