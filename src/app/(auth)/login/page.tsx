import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n";
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
  const loginAction = login.bind(null, "user");

  return (
    <div className="flex flex-col gap-4">

      {/* ── TaziMa Helping Hand Badge ────────────────────────────── */}
      <div className="flex justify-center mb-1">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-4 py-1.5 border border-accent/20 backdrop-blur-sm shadow-sm">
          <span className="text-xs font-bold text-accent tracking-wider uppercase">
            TaziMa Helping Hand
          </span>
        </div>
      </div>

      {/* ── Compact hero ─────────────────────────────────────────── */}
      <AuthHero title={t("auth.welcomeBack")} subtitle={t("auth.loginSubtitle")} />

      {/* ── Glass card ────────────────────────────────────────────── */}
      <GlassCard>
        <LoginForm
          role="user"
          action={loginAction}
          href={{ signup: "/signup" }}
          isPending={isPending}
        />
      </GlassCard>

    </div>
  );
}
