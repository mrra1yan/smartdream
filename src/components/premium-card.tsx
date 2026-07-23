"use client";

import { useState } from "react";
import { MessageCircle, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PendingPopup } from "@/components/pending-popup";
import { useI18n } from "@/components/i18n-provider";
import type { SiteSettings } from "@/lib/settings";
import { motion } from "framer-motion";

export function PremiumCard({
  title,
  settings,
  prefix,
  active,
}: {
  title: string;
  settings: SiteSettings;
  prefix: "boost" | "autolike";
  active: boolean;
}) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);

  const prices: { label: string; value: number | null }[] = [
    { label: t("premium.durNoExpiry"), value: settings[`${prefix}PriceNoExpiry` as keyof SiteSettings] as number | null },
    { label: t("premium.dur1w"), value: settings[`${prefix}Price1w` as keyof SiteSettings] as number | null },
    { label: t("premium.dur1m"), value: settings[`${prefix}Price1m` as keyof SiteSettings] as number | null },
    { label: t("premium.dur3m"), value: settings[`${prefix}Price3m` as keyof SiteSettings] as number | null },
    { label: t("premium.dur6m"), value: settings[`${prefix}Price6m` as keyof SiteSettings] as number | null },
    { label: t("premium.dur1y"), value: settings[`${prefix}Price1y` as keyof SiteSettings] as number | null },
    { label: t("premium.durUsage"), value: settings[`${prefix}PriceUsagePerUnit` as keyof SiteSettings] as number | null },
  ];

  return (
    <motion.div 
      
      className="relative group flex flex-col gap-5 overflow-hidden rounded-3xl bg-surface/60 p-6 shadow-xl ring-1 ring-border/50 transition-all hover:ring-accent/50 hover:shadow-accent/20"
    >
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-accent/20 blur-3xl group-hover:bg-accent/30 transition-colors" />
      
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-purple-600 text-white shadow-lg">
            <Star className="h-5 w-5 fill-white" />
          </div>
          <h2 className="text-xl font-bold bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">{title}</h2>
        </div>
        {active ? (
          <span className="rounded-full bg-green-500/20 px-3 py-1 text-xs font-bold uppercase text-green-600 dark:text-green-400 border border-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.2)]">
            {t("premium.active")}
          </span>
        ) : null}
      </div>

      <div className="relative grid grid-cols-2 gap-3 text-sm">
        {prices.map((p) => (
          <div key={p.label} className="group/price flex flex-col justify-between rounded-xl bg-background/50 px-3 py-2 border border-border/50 hover:bg-accent/5 hover:border-accent/20 transition-colors">
            <span className="text-[11px] font-semibold uppercase text-muted group-hover/price:text-accent/70">{p.label}</span>
            <span className="font-bold text-foreground">{p.value !== null ? `$${p.value}` : "—"}</span>
          </div>
        ))}
      </div>

      <Button 
        variant="default" 
        onClick={() => setShow(true)}
        className="relative mt-2 w-full overflow-hidden rounded-xl bg-foreground text-background transition-transform active:scale-95 group-hover:bg-gradient-to-r group-hover:from-accent group-hover:to-purple-600 group-hover:text-white"
      >
        <span className="relative z-10 flex items-center gap-2 font-semibold">
          <MessageCircle className="h-4 w-4" />
          {t("auth.contactAdmin")}
        </span>
      </Button>

      {show ? <PendingPopup whatsappNumber={settings.whatsappNumber} message={t("auth.contactAdmin")} onClose={() => setShow(false)} /> : null}
    </motion.div>
  );
}
