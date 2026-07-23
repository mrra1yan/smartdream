"use client";

import { useActionState } from "react";
import { type SettingsFormState } from "@/app/actions/settings";
import type { SiteSettings } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { FormField } from "@/components/form-field";
import { Settings, Save, Globe, Gift, Activity, CheckCircle2, Rocket } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";

export function SettingsForm({
  initial,
  action,
}: {
  initial: SiteSettings;
  action: (state: SettingsFormState, formData: FormData) => Promise<SettingsFormState>;
}) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState<SettingsFormState, FormData>(
    action,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-8 w-full py-2">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/20 pb-4">
        <h1 className="text-2xl font-black text-foreground flex items-center gap-2">
          <Settings className="h-6 w-6 text-accent" />
          {t("admin.settings")}
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
        {/* General Settings */}
        <div className="relative overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-xl flex flex-col gap-4">
          <div className="absolute -right-16 -top-16 h-36 w-36 rounded-full bg-accent/5 blur-3xl pointer-events-none" />

          <div className="flex items-center justify-between border-b border-border/10 pb-3">
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <Globe className="h-4 w-4 text-accent" />
              {t("admin.generalSettings")}
            </h3>
          </div>

          <FormField
            label={t("admin.whatsappNumber")}
            name="whatsappNumber"
            defaultValue={initial.whatsappNumber}
            placeholder="+8801XXXXXXXXX"
          />

          <div className="grid grid-cols-2 gap-4">
            <FormField
              label={t("admin.activeLikes")}
              name="activeLikeCount"
              type="number"
              defaultValue={String(initial.activeLikeCount)}
            />
            <FormField
              label={t("admin.activeHours")}
              name="activeWindowHours"
              type="number"
              defaultValue={String(initial.activeWindowHours)}
            />
          </div>
        </div>

        {/* Promotions */}
        <div className="relative overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-xl flex flex-col gap-4">
          <div className="absolute -right-16 -top-16 h-36 w-36 rounded-full bg-accent/5 blur-3xl pointer-events-none" />

          <div className="flex items-center justify-between border-b border-border/10 pb-3">
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <Gift className="h-4 w-4 text-accent" />
              {t("admin.promotions")}
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField
              label={t("admin.offerLikes")}
              name="offerLikesRequired"
              type="number"
              defaultValue={String(initial.offerLikesRequired)}
            />
            <FormField
              label={t("admin.offerMins")}
              name="offerAutoLikeMinutes"
              type="number"
              defaultValue={String(initial.offerAutoLikeMinutes)}
            />
          </div>

          <div className="flex items-center justify-between mt-2 rounded-2xl border border-border/30 bg-surface/80 p-4">
            <Label htmlFor="offerActive" className="text-xs font-semibold text-muted-foreground select-none cursor-pointer">
              {t("admin.enableOffer")}
            </Label>
            <label className="relative inline-flex items-center cursor-pointer select-none">
              <input
                id="offerActive"
                name="offerActive"
                type="checkbox"
                defaultChecked={initial.offerActive}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-border/50 dark:bg-zinc-800 rounded-full peer peer-focus:ring-2 peer-focus:ring-accent/30 peer-checked:bg-accent after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)]" />
            </label>
          </div>
        </div>

        {/* Referral reward minutes have moved to the super-admin-only
            settings page (see LevelReferralSettingsForm) — a plain admin
            should no longer be able to view or edit them here. */}
      </div>

      {/* Visually hidden for now. Wrapped in a hidden div instead of JSX comment-out 
          so that their values are still submitted and preserved in the database. */}
      <div className="hidden">
        <PriceCard
          title={t("admin.boostedPricing")}
          prefix="boost"
          initial={initial}
        />
        <PriceCard
          title={t("admin.autoLikePricing")}
          prefix="autolike"
          initial={initial}
        />
      </div>

      <div className="flex flex-col gap-3 items-end mt-4">
        {state?.error ? (
          <p className="text-sm font-semibold text-danger">{state.error}</p>
        ) : null}
        {state?.ok ? (
          <p className="text-sm font-semibold text-green-500 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-green-500" /> {t("admin.saveSuccess")}
          </p>
        ) : null}

        <Button type="submit" disabled={pending} variant="accent" size="lg" className="rounded-xl px-6 font-bold h-12 flex items-center gap-2">
          <Save className="h-5 w-5" />
          {pending ? t("admin.savingSettings") : t("admin.saveSettings")}
        </Button>
      </div>
    </form>
  );
}



function PriceCard({
  title,
  prefix,
  initial,
}: {
  title: string;
  prefix: "boost" | "autolike";
  initial: SiteSettings;
}) {
  const { t } = useI18n();
  const fields: { labelKey: string; name: string; value: number | null }[] = [
    { labelKey: "premium.durNoExpiry", name: `${prefix}PriceNoExpiry`, value: initial[`${prefix}PriceNoExpiry` as keyof SiteSettings] as number | null },
    { labelKey: "premium.dur1w", name: `${prefix}Price1w`, value: initial[`${prefix}Price1w` as keyof SiteSettings] as number | null },
    { labelKey: "premium.dur1m", name: `${prefix}Price1m`, value: initial[`${prefix}Price1m` as keyof SiteSettings] as number | null },
    { labelKey: "premium.dur3m", name: `${prefix}Price3m`, value: initial[`${prefix}Price3m` as keyof SiteSettings] as number | null },
    { labelKey: "premium.dur6m", name: `${prefix}Price6m`, value: initial[`${prefix}Price6m` as keyof SiteSettings] as number | null },
    { labelKey: "premium.dur1y", name: `${prefix}Price1y`, value: initial[`${prefix}Price1y` as keyof SiteSettings] as number | null },
    { labelKey: "premium.durUsage", name: `${prefix}PriceUsagePerUnit`, value: initial[`${prefix}PriceUsagePerUnit` as keyof SiteSettings] as number | null },
  ];

  return (
    <div className="relative overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 shadow-xl flex flex-col gap-4">
      <div className="absolute -right-16 -top-16 h-36 w-36 rounded-full bg-accent/5 blur-3xl pointer-events-none" />

      <div className="flex items-center justify-between border-b border-border/10 pb-3">
        <h3 className="text-base font-bold text-foreground flex items-center gap-2">
          {prefix === "boost" ? <Rocket className="h-4 w-4 text-accent" /> : <Activity className="h-4 w-4 text-purple-500" />}
          {title}
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {fields.map((f) => (
          <FormField
            key={f.name}
            label={t(f.labelKey)}
            name={f.name}
            type="number"
            defaultValue={f.value == null ? "" : String(f.value)}
          />
        ))}
      </div>
    </div>
  );
}
