import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n";
import { PageHeader } from "@/components/page-header";
import { ShieldAlert, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = { title: "Terms | Smart Dream" };

export default async function TermsPage() {
  const { t } = await getI18n();

  const rules = [
    t("terms.rule1"),
    t("terms.rule2"),
    t("terms.rule3"),
    t("terms.rule4"),
    t("terms.rule5"),
  ];

  return (
    <div className="flex flex-col gap-6 py-2">
      {/* Header */}
      <PageHeader
        badge={t("terms.badge")}
        title={t("terms.title")}
        description={t("terms.intro")}
      />

      {/* Rules list */}
      <div className="flex flex-col gap-3">
        {rules.map((rule, idx) => (
          <div
            key={idx}
            className="flex items-start gap-4 rounded-2xl border border-border/40 bg-surface/90 p-4 sm:p-5 hover:border-accent/20 hover:bg-surface/50 transition-colors"
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent mt-0.5">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <p className="text-sm sm:text-base leading-relaxed text-muted-foreground/95">
              {rule}
            </p>
          </div>
        ))}
      </div>

      {/* Outro notice card */}
      <div className="flex items-center gap-3 rounded-2xl border border-accent/20 bg-accent/5 p-4 text-xs sm:text-sm text-muted-foreground/90">
        <ShieldAlert className="h-5 w-5 text-accent shrink-0" />
        <span>{t("terms.outro")}</span>
      </div>
    </div>
  );
}
