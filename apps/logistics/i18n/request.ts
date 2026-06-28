import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "./locale";

/**
 * next-intl entry — runs on every server request. We read the locale from a
 * cookie (set by LocaleSettings) and fall back to the
 * default locale otherwise. Messages are dynamically imported so unused
 * locales don't ship to the client.
 */
export default getRequestConfig(async () => {
  const c = await cookies();
  const raw = c.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const messages = (await import(`../messages/${locale}.json`)).default;
  return {
    locale,
    messages,
  };
});
