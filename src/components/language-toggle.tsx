"use client";

import { useTransition } from "react";
import { setLocale } from "@/app/actions/i18n";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/types";

export function LanguageToggle({ className }: { className?: string }) {
  const { locale } = useI18n();
  const [pending, startTransition] = useTransition();

  function change(next: Locale) {
    if (next === locale) return;
    startTransition(() => void setLocale(next));
  }

  return (
    <div className={cn("inline-flex h-9 items-center rounded-xl border border-zinc-200 p-0.5 dark:border-zinc-800", className)}>
      {(["en", "bn"] as const).map((l) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          onClick={() => change(l)}
          className={cn(
            "rounded-lg h-full px-3 text-xs font-bold transition-colors flex items-center justify-center",
            locale === l
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
          )}
        >
          {l === "en" ? "EN" : "বাং"}
        </button>
      ))}
    </div>
  );
}
