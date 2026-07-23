"use client";

import { Clock, Infinity, Medal } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/components/i18n-provider";

function minsFrom(expiry: string): number {
  return Math.max(0, Math.floor((new Date(expiry).getTime() - Date.now()) / 60000));
}

export function PremiumStatusCard({
  title,
  active,
  model,
  remainingLikes,
  remainingMinutes,
  expiry,
  freeMinutes,
}: {
  title: string;
  active: boolean;
  model: string;
  remainingLikes: number | null;
  remainingMinutes?: number | null;
  expiry?: string | null;
  freeMinutes?: boolean;
}) {
  const { t } = useI18n();
  const computedMins = remainingMinutes ?? (expiry ? minsFrom(expiry) : null);

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Medal className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            active
              ? "bg-green-500/15 text-green-600 dark:text-green-400"
              : "bg-zinc-200 dark:bg-zinc-800 text-muted"
          }`}
        >
          {active ? t("premium.active") : t("premium.inactive")}
        </span>
      </div>

      {active ? (
        <div className="flex flex-wrap gap-2 text-xs text-muted">
          {freeMinutes && model !== "no_expiry" ? (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {t("premium.freeMinutes")}
            </span>
          ) : null}
          {model === "no_expiry" ? (
            <span className="flex items-center gap-1">
              <Infinity className="h-3 w-3" />
              {t("premium.noExpiry")}
            </span>
          ) : null}
          {remainingLikes != null && model !== "no_expiry" ? (
            <span>{remainingLikes} {t("premium.likesRemaining")}</span>
          ) : null}
          {computedMins != null && model !== "no_expiry" ? (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {computedMins} {t("premium.minRemaining")}
            </span>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
