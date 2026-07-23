import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { SignupForm } from "@/components/signup-form";
import { GlassCard } from "@/components/glass-card";
import { AuthHero } from "@/components/auth-hero";
import { signup } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Sign up | Smart Dream" };

export default async function SignupPage(props: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const searchParams = await props.searchParams;
  const { t } = await getI18n();
  const settings = await getSettings();

  return (
    <div className="flex flex-col gap-4">

      {/* ── Compact hero ─────────────────────────────────────────── */}
      <AuthHero title={t("auth.signup")} subtitle={t("auth.signupSubtitle")} />

      {/* ── Glass card ────────────────────────────────────────────── */}
      <GlassCard>
        <SignupForm action={signup} whatsappNumber={settings.whatsappNumber} referralCode={searchParams.ref} />
      </GlassCard>

    </div>
  );
}
