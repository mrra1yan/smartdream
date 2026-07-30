"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Locale } from "@/lib/types";
import type { Dictionary } from "@/lib/i18n/types";
import { DEFAULT_LOCALE } from "@/lib/types";
import enDict from "@/lib/i18n/en.json";
import bnDict from "@/lib/i18n/bn.json";

type I18nValue = {
  locale: Locale;
  dictionary: Dictionary;
  t: (path: string, replace?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

// Static dictionary map — avoids unreliable dynamic import() with variable paths.
const DICTIONARIES: Record<Locale, Dictionary> = {
  en: enDict as Dictionary,
  bn: bnDict as Dictionary,
};

function translate(dictionary: Dictionary, path: string): string {
  const parts = path.split(".");
  let current: unknown = dictionary;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return path;
    }
  }
  return typeof current === "string" ? current : path;
}

/**
 * Reads the locale cookie client-side. Mirrors server-side `getLocale()` in
 * `@/lib/i18n/index.ts` and the `LOCALE_COOKIE` constant.
 */
function getClientLocale(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const match = document.cookie.match(/(?:^|;\s*)locale=([^;]*)/);
  const value = match?.[1];
  return value === "en" || value === "bn" ? value : DEFAULT_LOCALE;
}

export function I18nProvider({
  locale,
  dictionary,
  children,
}: {
  locale: Locale;
  dictionary: Dictionary;
  children: ReactNode;
}) {
  const value: I18nValue = {
    locale,
    dictionary,
    t: (path, replace) => {
      let val = translate(dictionary, path);
      if (replace) {
        for (const [k, v] of Object.entries(replace)) {
          val = val.replaceAll(`{${k}}`, String(v));
        }
      }
      return val;
    },
  };
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside <I18nProvider>");
  }
  return ctx;
}

// ── I18nShell: client-side locale bootstrapper ─────────────────────────
// Replaces the server-side `getI18n()` in the root layout so the layout
// itself can stay static (no `cookies()` call). Starts with the default
// locale (en) immediately — no blank screen — then switches to the
// cookie-resolved locale on mount. Both dictionaries are statically
// imported to avoid unreliable dynamic import() with variable paths.

export function I18nShell({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const resolved = getClientLocale();
    setLocale(resolved);
    document.documentElement.lang = resolved;
  }, []);

  const dictionary = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];

  return (
    <I18nProvider locale={locale} dictionary={dictionary}>
      {children}
    </I18nProvider>
  );
}
