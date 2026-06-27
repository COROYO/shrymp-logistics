"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSlipBrandingAction } from "./slip-branding-actions";
import type { SlipBrandingConfig } from "@/lib/slip/defaults";

const labelClass =
  "block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60";

const inputClass =
  "mt-1.5 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-brand-ink shadow-sm focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

export function SlipBrandingForm({ current }: { current: SlipBrandingConfig }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveSlipBrandingAction(fd);
      if (res.ok) {
        setMsg({ ok: true, text: "Lieferschein-Branding gespeichert." });
        router.refresh();
      } else {
        setMsg({
          ok: false,
          text: `Fehler: ${res.error}${
            res.details ? ` — ${JSON.stringify(res.details)}` : ""
          }`,
        });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Markenname</label>
          <input
            name="brand_name"
            required
            maxLength={80}
            defaultValue={current.brand_name}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Subheadline (Eyebrow)</label>
          <input
            name="eyebrow"
            maxLength={120}
            defaultValue={current.eyebrow}
            className={inputClass}
            placeholder="z. B. Lager neu gedacht"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Firma & Adresse</label>
          <input
            name="company_line"
            maxLength={200}
            defaultValue={current.company_line}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Kontakt-E-Mail</label>
          <input
            name="contact_email"
            type="email"
            required
            maxLength={120}
            defaultValue={current.contact_email}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Dokumenttitel</label>
          <input
            name="document_title"
            required
            maxLength={40}
            defaultValue={current.document_title}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Akzentfarbe (#RRGGBB)</label>
          <input
            name="accent_color"
            type="text"
            required
            pattern="^#[0-9A-Fa-f]{6}$"
            defaultValue={current.accent_color}
            className={`${inputClass} font-mono`}
          />
        </div>
        <div>
          <label className={labelClass}>Header-/Tabellenfarbe (#RRGGBB)</label>
          <input
            name="header_color"
            type="text"
            required
            pattern="^#[0-9A-Fa-f]{6}$"
            defaultValue={current.header_color}
            className={`${inputClass} font-mono`}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Abschlusstext / Signatur</label>
          <textarea
            name="signature"
            rows={3}
            maxLength={500}
            defaultValue={current.signature}
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Footer (Rechtliches)</label>
          <textarea
            name="footer_legal"
            rows={2}
            maxLength={400}
            defaultValue={current.footer_legal}
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {pending ? "Speichern…" : "Branding speichern"}
        </button>
        {msg ? (
          <span
            className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}
          >
            {msg.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
