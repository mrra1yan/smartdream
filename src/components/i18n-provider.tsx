"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "@/lib/types";
import type { Dictionary } from "@/lib/i18n/types";

type I18nValue = {
  locale: Locale;
  dictionary: Dictionary;
  t: (path: string, replace?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

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
