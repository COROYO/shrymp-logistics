import type { Locale } from "@/i18n/locale";

/**
 * Pick the locale we should print customer-facing documents (packing slips,
 * later emails) in, based on the recipient's shipping country.
 *
 * DE-speaking countries get `de`, Russian-speaking get `ru`, Polish get `pl`,
 * Turkish get `tr`. Everything else defaults to English so we don't ship a
 * German slip to a French customer.
 */
const DE_COUNTRIES = new Set(["DE", "AT", "CH", "LI", "LU"]);
const RU_COUNTRIES = new Set(["RU", "BY", "KZ", "UA", "KG", "TJ", "UZ", "MD", "AM"]);
const PL_COUNTRIES = new Set(["PL"]);
const TR_COUNTRIES = new Set(["TR"]);

export function customerLocaleFromCountry(
  countryCode: string | null | undefined,
): Locale {
  const cc = countryCode?.toUpperCase();
  if (!cc) return "de"; // shop is German — safest default
  if (DE_COUNTRIES.has(cc)) return "de";
  if (RU_COUNTRIES.has(cc)) return "ru";
  if (PL_COUNTRIES.has(cc)) return "pl";
  if (TR_COUNTRIES.has(cc)) return "tr";
  return "en";
}
