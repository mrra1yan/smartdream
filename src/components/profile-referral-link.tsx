"use client";

import { useState, useEffect } from "react";
import { Link2, Copy, Check } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";

export function ProfileReferralLink({ publicId, rewardMinutes }: { publicId: string, rewardMinutes?: number }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setUrl(`${window.location.origin}/signup?ref=${publicId}`);
    }
  }, [publicId]);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex flex-col items-center gap-1.5 w-full mt-2.5 pt-2.5 border-t border-border/20">
      {rewardMinutes && rewardMinutes > 0 && (
        <span className="text-[10px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full mb-1 border border-accent/20">
          {t("profile.referralRewardHint") || `Invite a friend & get ${rewardMinutes} min Auto-Like!`}
        </span>
      )}
      <span className="text-xs font-bold uppercase text-muted-foreground/80 flex items-center gap-1">
        <Link2 className="h-3 w-3 text-purple-500" />
        {t("profile.referralLink") || "Referral Link"}
      </span>
      <button
        type="button"
        onClick={copy}
        disabled={!url}
        className="inline-flex items-center gap-2 hover:text-accent transition-colors max-w-full group"
      >
        <span className="font-mono text-xs font-medium text-muted-foreground group-hover:text-foreground truncate transition-colors max-w-[220px]">
          {url || "..."}
        </span>
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-muted group-hover:text-accent shrink-0 transition-colors" />
        )}
      </button>
    </div>
  );
}
