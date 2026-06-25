/**
 * App locale wiring for next-intl, cookie-based (no URL prefixes).
 *
 * Why cookie and not `/de/...` prefix? This is an internal warehouse tool —
 * not SEO-relevant — and rewriting every link with the locale prefix would
 * be churn for no benefit. The cookie sticks per session.
 */

export const LOCALES = ["de", "en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "de";
export const LOCALE_COOKIE = "monolith-locale";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

export const LOCALE_LABELS: Record<Locale, string> = {
  de: "Deutsch",
  en: "English",
  ru: "Русский",
};
