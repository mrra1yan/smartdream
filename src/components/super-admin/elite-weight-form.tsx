"use client";

import { Award } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/components/i18n-provider";

// Elite links always rank first in the regular feed -- an unconditional,
// all-or-nothing priority tier (see src/lib/feed.ts's `combined` array and
// src/app/actions/like.ts's `isBypass`, which also exempts elite owners from
// the exposure/deficit check the same unconditional way). There used to be
// an adjustable 0-100x "Elite Weight" slider here that read
// settings.eliteWeight, but that value was never actually consulted by the
// feed ranking (elite users are split out and placed first before the
// weighted comparator ever runs) -- the slider promised a scale of
// prioritization that had no effect. Replaced with this static explanation
// instead of a control that doesn't do anything.
export function EliteWeightForm() {
  const { t } = useI18n();

  return (
    <Card className="flex flex-col gap-3 p-6">
      <div className="flex items-center gap-2">
        <Award className="h-5 w-5 text-accent" />
        <h2 className="text-lg font-bold text-foreground">{t("superAdmin.eliteWeight")}</h2>
      </div>
      <p className="text-xs text-muted-foreground/80 leading-relaxed">
        {t("superAdmin.eliteWeightDesc")}
      </p>
    </Card>
  );
}
