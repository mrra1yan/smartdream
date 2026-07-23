"use client";

import { useState } from "react";
import { Sparkles, MessageCircle, Clock, Infinity, Medal, Rocket, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PendingPopup } from "@/components/pending-popup";
import { useI18n } from "@/components/i18n-provider";
import type { SiteSettings } from "@/lib/settings";
import { motion } from "framer-motion";

function minsFrom(expiry: string): number {
  return Math.max(0, Math.floor((new Date(expiry).getTime() - Date.now()) / 60000));
}

interface PremiumFeatureCardProps {
  type: "boosted" | "autolike";
  title: string;
  description: string;
  active: boolean;
  model: string;
  remainingLikes: number | null;
  remainingMinutes?: number | null;
  expiry?: string | null;
  freeMinutes?: boolean;
  settings: SiteSettings;
  whatsappNumber: string;
  userName?: string;
  userPublicId?: string;
}

export function PremiumFeatureCard({
  type,
  title,
  description,
  active,
  model,
  remainingLikes,
  remainingMinutes,
  expiry,
  freeMinutes,
  settings,
  whatsappNumber,
  userName,
  userPublicId,
}: PremiumFeatureCardProps) {
  const { t, locale } = useI18n();
  const [showPopup, setShowPopup] = useState(false);

  const prefix = type === "boosted" ? "boost" : "autolike";

  const prices: { label: string; value: number | null }[] = [
    { label: t("premium.durNoExpiry"), value: settings[`${prefix}PriceNoExpiry` as keyof SiteSettings] as number | null },
    { label: t("premium.dur1w"), value: settings[`${prefix}Price1w` as keyof SiteSettings] as number | null },
    { label: t("premium.dur1m"), value: settings[`${prefix}Price1m` as keyof SiteSettings] as number | null },
    { label: t("premium.dur3m"), value: settings[`${prefix}Price3m` as keyof SiteSettings] as number | null },
    { label: t("premium.dur6m"), value: settings[`${prefix}Price6m` as keyof SiteSettings] as number | null },
    { label: t("premium.dur1y"), value: settings[`${prefix}Price1y` as keyof SiteSettings] as number | null },
    { label: t("premium.durUsage"), value: settings[`${prefix}PriceUsagePerUnit` as keyof SiteSettings] as number | null },
  ];

  const computedMins = remainingMinutes ?? (expiry ? minsFrom(expiry) : null);
  const Icon = type === "boosted" ? Rocket : Sparkles;

  // Helper to convert English digits to Bengali when locale is bn
  const toBengaliNumber = (num: number | string): string => {
    const str = String(num);
    if (locale !== "bn") return str;
    const bnDigits = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
    return str.replace(/[0-9]/g, (digit) => bnDigits[parseInt(digit)]);
  };

  const tableRows = type === "boosted"
    ? [
        {
          name: t("premium.featureTraffic") || "Traffic Delivery",
          regular: true,
          regularText: t("premium.organic") || "Organic Only",
          premium: true,
          premiumText: t("premium.guaranteed") || "Guaranteed",
        },
        {
          name: t("premium.featurePosition") || "Feed Position",
          regular: true,
          regularText: t("premium.normal") || "Normal",
          premium: true,
          premiumText: t("premium.topPinned") || "Top Pinned",
        },
        {
          name: t("premium.featureLimiter") || "Speed Limiter",
          regular: true,
          regularText: t("premium.active") || "Active",
          premium: false,
        },
        {
          name: t("premium.featureBadge") || "Featured Badge",
          regular: false,
          premium: true,
        },
      ]
    : [
        {
          name: t("premium.featureLiking") || "Liking Mode",
          regular: true,
          regularText: t("premium.manual") || "Manual",
          premium: true,
          premiumText: t("premium.automatic") || "Auto",
        },
        {
          name: t("premium.featureEffort") || "User Action",
          regular: true,
          regularText: t("premium.actionManual") || "Manual Clicking",
          premium: true,
          premiumText: t("premium.actionAuto") || "1-Click Start",
        },
        {
          name: t("premium.featureBackground") || "Background Run",
          regular: false,
          premium: true,
        },
        {
          name: t("premium.featureClaim") || "Auto Claim",
          regular: false,
          premium: true,
        },
      ];

  return (
    <motion.div
      
      className="relative group flex flex-col justify-between gap-6 overflow-hidden rounded-3xl border border-border/50 bg-surface/90 p-6 sm:p-8 shadow-xl transition-all hover:border-accent/40"
    >
      {/* Background dual glow blobs */}
      <div className="absolute -right-12 -top-12 h-36 w-36 rounded-full bg-accent/10 blur-3xl group-hover:bg-accent/20 transition-all duration-500" />
      <div className="absolute -left-12 -bottom-12 h-36 w-36 rounded-full bg-purple-600/5 blur-3xl group-hover:bg-purple-600/10 transition-all duration-500" />

      <div className="space-y-5">
        {/* Card Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-purple-600 text-white shadow-lg shadow-accent/20">
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-foreground">
                {title}
              </h2>
              <p className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">
                {description}
              </p>
            </div>
          </div>

          <span
            className={`rounded-full px-3 py-0.5 text-xs font-bold uppercase border shrink-0 ${
              active
                ? "bg-green-500/10 border-green-500/20 text-green-500 shadow-[0_0_15px_rgba(34,197,94,0.15)] animate-pulse"
                : "bg-zinc-200/50 dark:bg-zinc-800/80 border-border text-muted-foreground"
            }`}
          >
            {active ? t("premium.active") : t("premium.inactive")}
          </span>
        </div>

        {/* Feature Comparison Table */}
        <div className="w-full overflow-x-auto rounded-2xl border border-border/30 bg-background/25 mt-4">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border/20 bg-background/40 text-[9px] sm:text-[10px] font-bold uppercase text-muted-foreground/80 whitespace-nowrap">
                <th className="p-2.5 sm:p-3">{t("premium.feature")}</th>
                <th className="p-2.5 sm:p-3 text-center w-24 sm:w-28">{t("premium.regular")}</th>
                <th className="p-2.5 sm:p-3 text-center w-24 sm:w-28 bg-accent/5 text-accent">{type === "boosted" ? t("premium.boosted") : t("premium.autoLike")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/10 whitespace-nowrap">
              {tableRows.map((row, idx) => (
                <tr key={idx} className="hover:bg-background/10 transition-colors">
                  <td className="p-2.5 sm:p-3 font-semibold text-foreground/80">{row.name}</td>
                  <td className="p-2.5 sm:p-3 text-center">
                    {row.regular ? (
                      row.regularText ? (
                        <span className="text-[10px] sm:text-xs font-bold text-muted-foreground">{row.regularText}</span>
                      ) : (
                        <Check className="h-4 w-4 text-emerald-500 mx-auto" />
                      )
                    ) : (
                      <X className="h-4 w-4 text-rose-500 mx-auto" />
                    )}
                  </td>
                  <td className="p-2.5 sm:p-3 text-center bg-accent/5">
                    {row.premium ? (
                      row.premiumText ? (
                        <span className="text-[10px] sm:text-xs font-black text-accent">{row.premiumText}</span>
                      ) : (
                        <Check className="h-4 w-4 text-accent mx-auto" />
                      )
                    ) : (
                      <X className="h-4 w-4 text-rose-500 mx-auto" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Active Status Info Section */}
        {active && (
          <div className="flex items-center gap-3 rounded-2xl border border-green-500/20 bg-green-500/5 p-4 text-xs sm:text-sm text-green-500/90 shadow-inner">
            <Medal className="h-5 w-5 shrink-0" />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-semibold">
              {freeMinutes && model !== "no_expiry" && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {t("premium.freeMinutes")}
                </span>
              )}
              {model === "no_expiry" && (
                <span className="flex items-center gap-1">
                  <Infinity className="h-3.5 w-3.5" />
                  {t("premium.noExpiry")}
                </span>
              )}
              {remainingLikes != null && model !== "no_expiry" && (
                <span>
                  {toBengaliNumber(remainingLikes)} {t("premium.likesRemaining")}
                </span>
              )}
              {computedMins != null && model !== "no_expiry" && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {toBengaliNumber(computedMins)} {t("premium.minRemaining")}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Pricing Plan Grid */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          {prices.map((p) => {
            if (p.value === null) return null;
            const isPopular = p.label === t("premium.dur1m");
            
            return (
              <div
                key={p.label}
                className={`relative group/price flex flex-col justify-between rounded-2xl border p-3.5 transition-all overflow-hidden ${
                  isPopular
                    ? "border-accent/40 bg-accent/5 hover:bg-accent/10"
                    : "border-border/40 bg-background/30 hover:bg-accent/5 hover:border-accent/20"
                }`}
              >
                {isPopular && (
                  <span className="absolute right-2 top-2 rounded bg-accent px-1.5 py-0.5 text-[8px] font-black uppercase text-white shadow-sm shadow-accent/20">
                    {t("premium.popular")}
                  </span>
                )}
                <span className="text-[10px] font-bold uppercase text-muted-foreground/80 group-hover/price:text-accent/70">
                  {p.label}
                </span>
                <span className="text-base font-black text-foreground mt-1.5">
                  {t("premium.priceFormat", { price: toBengaliNumber(p.value) })}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {!active && (
        <Button
          onClick={() => setShowPopup(true)}
          className="w-full rounded-xl bg-accent hover:bg-accent/90 text-white font-bold gap-2 py-5 transition-colors"
        >
          <MessageCircle className="h-5 w-5 shrink-0" />
          <span>{t("premium.contactAdmin")}</span>
        </Button>
      )}

      {showPopup && (
        <PendingPopup
          whatsappNumber={whatsappNumber}
          message={t("premium.contactAdminPrompt")}
          whatsappMessage={
            type === "boosted"
              ? t("premium.whatsappMessageBoosted", { name: userName ?? "", id: userPublicId ?? "" })
              : t("premium.whatsappMessageAutoLike", { name: userName ?? "", id: userPublicId ?? "" })
          }
          onClose={() => setShowPopup(false)}
        />
      )}
    </motion.div>
  );
}
