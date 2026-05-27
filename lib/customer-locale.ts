import type { Locale } from "@/i18n/locale";

/**
 * Pick the locale we should print customer-facing documents (packing slips,
 * later emails) in, based on the recipient's shipping country.
 *
 * DE-speaking countries get `de`, Russian-speaking get `ru`, everything else
 * defaults to English so we don't ship a German slip to a French customer.
 */
const DE_COUNTRIES = new Set(["DE", "AT", "CH", "LI", "LU"]);
const RU_COUNTRIES = new Set(["RU", "BY", "KZ", "UA", "KG", "TJ", "UZ", "MD", "AM"]);

export function customerLocaleFromCountry(
  countryCode: string | null | undefined,
): Locale {
  const cc = countryCode?.toUpperCase();
  if (!cc) return "de"; // shop is German — safest default
  if (DE_COUNTRIES.has(cc)) return "de";
  if (RU_COUNTRIES.has(cc)) return "ru";
  return "en";
}
