"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSlipBrandingAction } from "./slip-branding-actions";
import {
  normalizeSlipQrUrl,
  SLIP_FONT_SIZE_MAX_PT,
  SLIP_FONT_SIZE_MIN_PT,
  type SlipBrandingConfig,
  type SlipLayoutFlag,
} from "@/lib/slip/defaults";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

const labelClass =
  "block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60";

const inputClass =
  "mt-1.5 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-brand-ink shadow-sm focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

const HEADER_TOGGLES = [
  { name: "show_eyebrow", label: "Subheadline" },
  { name: "show_address", label: "Anschrift" },
  { name: "show_email", label: "E-Mail" },
  { name: "show_document_title", label: "Dokumenttitel" },
  { name: "show_header_ls_no", label: "Lieferscheinnummer rechts" },
] as const satisfies readonly { name: SlipLayoutFlag; label: string }[];

const META_TOGGLES = [
  { name: "show_customer_no", label: "Kundennummer" },
  { name: "show_ls_no", label: "Lieferscheinnummer" },
  { name: "show_ls_date", label: "Lieferscheindatum" },
  { name: "show_order_no", label: "Bestellnummer" },
  { name: "show_order_date", label: "Bestelldatum" },
  { name: "show_page", label: "Seite" },
] as const satisfies readonly { name: SlipLayoutFlag; label: string }[];

const COLUMN_TOGGLES = [
  { name: "col_sku", label: "Art.-Nr." },
  { name: "col_bin", label: "Lagerplatz" },
  { name: "col_qty", label: "Menge" },
  { name: "col_charge", label: "Charge" },
] as const satisfies readonly { name: SlipLayoutFlag; label: string }[];

const EXTRA_TOGGLES = [
  { name: "col_image", label: "Produktbilder" },
  { name: "show_order_note", label: "Notiz zur Bestellung" },
] as const satisfies readonly { name: SlipLayoutFlag; label: string }[];

/** Compile-time check: every layout flag has a checkbox, or save would store it as off. */
type CoveredFlag = (
  | typeof HEADER_TOGGLES
  | typeof META_TOGGLES
  | typeof COLUMN_TOGGLES
  | typeof EXTRA_TOGGLES
)[number]["name"];
type MissingLayoutFlag = Exclude<SlipLayoutFlag, CoveredFlag>;
const _allFlagsCovered: MissingLayoutFlag extends never ? true : never = true;
void _allFlagsCovered;

export function SlipBrandingForm({
  current,
}: {
  current: SlipBrandingConfig;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [qrUrl, setQrUrl] = useState(current.qr_url);
  const qrPreview = normalizeSlipQrUrl(qrUrl);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveSlipBrandingAction(fd);
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Lieferschein",
          message: "Lieferschein-Branding gespeichert.",
        });
        router.refresh();
      } else {
        dispatchAdminJobError({
          title: "Lieferschein",
          message: `${res.error}${
            res.details ? ` — ${JSON.stringify(res.details)}` : ""
          }`,
        });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
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
          <label className={labelClass}>Anschrift im Briefkopf</label>
          <textarea
            name="company_line"
            rows={5}
            maxLength={600}
            defaultValue={current.company_line}
            className={inputClass}
            placeholder={"Muster GmbH\nMusterstraße 12\n51373 Leverkusen\nDeutschland"}
          />
          <p className="mt-1.5 text-xs text-brand-navy/60">
            Eine Zeile pro Bestandteil. So erscheint die vollständige Anschrift
            unter dem Markennamen.
          </p>
        </div>
        <div>
          <label className={labelClass}>Kontakt-E-Mail</label>
          <input
            name="contact_email"
            type="email"
            maxLength={120}
            defaultValue={current.contact_email}
            className={inputClass}
          />
          <p className="mt-1.5 text-xs text-brand-navy/60">
            Leer lassen, dann steht auf dem Lieferschein kein Kontakt-Hinweis.
          </p>
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

      <fieldset className="space-y-3">
        <legend className={labelClass}>QR-Code</legend>
        <p className="text-xs text-brand-navy/60">
          Bild-URL. Steht unten rechts neben dem Abschlusstext. Leer lassen,
          dann erscheint kein QR-Code.
        </p>
        {qrPreview ? (
          // eslint-disable-next-line @next/next/no-img-element -- merchant-supplied URL
          <img
            src={qrPreview}
            alt="QR-Code Vorschau"
            className="h-28 w-28 rounded-md border border-zinc-200 bg-white object-contain"
          />
        ) : null}
        <input
          name="qr_url"
          type="url"
          inputMode="url"
          maxLength={2000}
          value={qrUrl}
          onChange={(e) => setQrUrl(e.target.value)}
          placeholder="https://"
          className={inputClass}
        />
      </fieldset>

      <ToggleGroup
        title="Briefkopf"
        hint="Welche Angaben oben links und rechts gedruckt werden."
        toggles={HEADER_TOGGLES}
        current={current}
      />
      <ToggleGroup
        title="Angaben unter dem Briefkopf"
        hint="Kunden-, Beleg- und Bestelldaten in der Zeile über der Lieferadresse."
        toggles={META_TOGGLES}
        current={current}
      />
      <ToggleGroup
        title="Tabellenspalten"
        hint="Produkt bleibt immer sichtbar. Art.-Nr. steht unter dem Produktnamen. Charge erscheint nur, wenn Chargen aktiv sind."
        toggles={COLUMN_TOGGLES}
        current={current}
      />
      <ToggleGroup
        title="Zusätzliche Inhalte"
        hint="Produktbild steht klein links neben dem Produktnamen. Die Notiz aus der Shopify-Bestellung erscheint unter der Lieferadresse, nur wenn eine vorhanden ist."
        toggles={EXTRA_TOGGLES}
        current={current}
      />
      <fieldset className="space-y-3">
        <legend className={labelClass}>Schriftgröße in der Tabelle</legend>
        <p className="text-xs text-brand-navy/60">
          Punktgröße für den Produktnamen und die Art.-Nr. darunter.{" "}
          {SLIP_FONT_SIZE_MIN_PT}–{SLIP_FONT_SIZE_MAX_PT} pt.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="title_size_pt">
              Produkttitel (pt)
            </label>
            <input
              id="title_size_pt"
              name="title_size_pt"
              type="number"
              required
              min={SLIP_FONT_SIZE_MIN_PT}
              max={SLIP_FONT_SIZE_MAX_PT}
              step={1}
              defaultValue={current.title_size_pt}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="sku_size_pt">
              Art.-Nr. (pt)
            </label>
            <input
              id="sku_size_pt"
              name="sku_size_pt"
              type="number"
              required
              min={SLIP_FONT_SIZE_MIN_PT}
              max={SLIP_FONT_SIZE_MAX_PT}
              step={1}
              defaultValue={current.sku_size_pt}
              className={inputClass}
            />
          </div>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {pending ? "Speichern…" : "Branding speichern"}
        </button>
      </div>
    </form>
  );
}

function ToggleGroup({
  title,
  hint,
  toggles,
  current,
}: {
  title: string;
  hint: string;
  toggles: readonly { name: SlipLayoutFlag; label: string }[];
  current: SlipBrandingConfig;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className={labelClass}>{title}</legend>
      <p className="text-xs text-brand-navy/60">{hint}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {toggles.map((toggle) => (
          <label
            key={toggle.name}
            className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-brand-navy"
          >
            <input
              type="checkbox"
              name={toggle.name}
              value="1"
              defaultChecked={current[toggle.name]}
              className="h-4 w-4 rounded border-zinc-300"
            />
            {toggle.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
