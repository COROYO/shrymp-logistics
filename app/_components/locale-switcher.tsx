"use client";
import { useTransition } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locale";

/**
 * Compact 3-button locale switcher. Stores the choice in a server cookie via
 * /api/locale, then refreshes the route tree so the new translations render.
 */
export function LocaleSwitcher() {
  const current = useLocale() as Locale;
  const router = useRouter();
  const [pending, start] = useTransition();

  function setLocale(next: Locale) {
    if (next === current) return;
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
    <div
      className="flex items-center gap-0.5 rounded-md border border-white/10 bg-white/5 p-0.5"
      role="group"
      aria-label="Sprache"
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          onClick={() => setLocale(l)}
          title={LOCALE_LABELS[l]}
          aria-pressed={l === current}
          className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition disabled:opacity-50 ${
            l === current
              ? "bg-brand-burgundy text-white shadow"
              : "text-white/70 hover:bg-white/10 hover:text-white"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
