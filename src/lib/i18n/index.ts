import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, type Locale } from "@/lib/types";
import en from "./en.json";
import bn from "./bn.json";
import type { Dictionary } from "./types";

const dictionaries: Record<Locale, Dictionary> = {
  en,
  bn,
};

export const LOCALE_COOKIE = "locale";

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "en" || value === "bn";
}

/** Reads the locale from the cookie. Falls back to the default locale. */
export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const value = cookieStore.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
}

/** Resolves both the locale and dictionary in one call for server components. */
export async function getI18n() {
  const locale = await getLocale();
  const dictionary = getDictionary(locale);
  return { locale, dictionary, t: makeTranslator(dictionary) };
}

export function makeTranslator(dict: Dictionary) {
  return function t(path: string, replace?: Record<string, string | number>): string {
    const parts = path.split(".");
    let current: unknown = dict;
    for (const part of parts) {
      if (current && typeof current === "object" && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return path;
      }
    }
    let val = typeof current === "string" ? current : path;
    if (replace) {
      for (const [k, v] of Object.entries(replace)) {
        val = val.replaceAll(`{${k}}`, String(v));
      }
    }
    return val;
  };
}
