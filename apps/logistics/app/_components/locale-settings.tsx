"use client";
import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locale";

/**
 * UI locale picker for settings pages. Persists via /api/locale cookie, then
 * refreshes the route tree so translations re-render.
 */
export function LocaleSettings() {
  const current = useLocale() as Locale;
  const t = useTranslations("settings.language");
  const router = useRouter();
  const [pending, start] = useTransition();

  function setLocale(next: Locale) {
    if (next === current || pending) return;
    start(async () => {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      router.refresh();
    });
  }

  return (
    <fieldset className="space-y-3" disabled={pending} aria-busy={pending}>
      <legend className="sr-only">{t("title")}</legend>
      {LOCALES.map((l) => (
        <label
          key={l}
          className={`flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3 transition ${
            l === current
              ? "border-brand-burgundy/40 bg-brand-burgundy-soft/30"
              : "border-zinc-200 bg-zinc-50 hover:border-zinc-300"
          } ${pending ? "opacity-60" : ""}`}
        >
          <input
            type="radio"
            name="locale"
            value={l}
            checked={l === current}
            onChange={() => setLocale(l)}
            className="h-4 w-4"
          />
          <span className="text-sm font-semibold text-brand-navy">
            {LOCALE_LABELS[l]}
          </span>
          <span className="ml-auto font-mono text-[11px] uppercase text-brand-navy/40">
            {l}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
