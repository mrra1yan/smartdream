"use client";

import { useState, useTransition } from "react";
import { setLevelReferralSettings } from "@/app/actions/super-admin";
import { Loader2 } from "lucide-react";
import { SiteSettings } from "@/lib/settings";
import { useI18n } from "@/components/i18n-provider";

export function LevelReferralSettingsForm({ current }: { current: SiteSettings }) {
  const { t } = useI18n();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage("");
    const formData = new FormData(e.currentTarget);
    
    const args = {
      referralRewardReferrerMinutes: Number(formData.get("referralRewardReferrerMinutes")),
      referralRewardRefereeMinutes: Number(formData.get("referralRewardRefereeMinutes")),
    };

    startTransition(async () => {
      const res = await setLevelReferralSettings(args);
      if (res.error) setMessage(res.error);
      else setMessage(t("admin.saveSuccess"));
    });
  };

  const inputClass = "w-full rounded-xl border border-border/50 bg-background/50 px-4 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all";
  const labelClass = "block text-xs font-semibold text-muted-foreground mb-1";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 rounded-2xl border p-6 bg-surface/90">
      
      {/* Referral Rewards */}
      <div>
        <h2 className="text-lg font-bold mb-4">{t("admin.referralRewardsHeader")}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
          <div className="flex flex-col gap-1">
            <label className={labelClass}>{t("admin.referrerBonus")}</label>
            <p className="text-[10px] text-muted-foreground mb-1 leading-snug">
              {t("admin.referrerBonusDesc")}
            </p>
            <input
              name="referralRewardReferrerMinutes"
              type="number"
              min={0}
              defaultValue={current.referralRewardReferrerMinutes}
              className={inputClass}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelClass}>{t("admin.refereeBonus")}</label>
            <p className="text-[10px] text-muted-foreground mb-1 leading-snug">
              {t("admin.refereeBonusDesc")}
            </p>
            <input
              name="referralRewardRefereeMinutes"
              type="number"
              min={0}
              defaultValue={current.referralRewardRefereeMinutes}
              className={inputClass}
              required
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("admin.saveConfig")}
        </button>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
    </form>
  );
}
