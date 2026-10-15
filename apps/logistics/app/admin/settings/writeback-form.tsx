"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveWritebackAction } from "./writeback-actions";
import {
  DEFAULT_SHOPIFY_TAG_PACKED,
  DEFAULT_SHOPIFY_TAG_SHIP,
  DEFAULT_SHOPIFY_TAG_STOP,
} from "@/lib/lager/defaults";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

export type WritebackFormValue = {
  shopify_writeback_tags: boolean;
  shopify_writeback_fulfillment: boolean;
  shopify_fulfillment_notify_customer: boolean;
  shopify_writeback_inventory: boolean;
  catalog_sync_to_shopify: boolean;
  shopify_tag_ship: string;
  shopify_tag_stop: string;
  shopify_tag_packed: string;
  inventory_source: "APP" | "SHOPIFY";
};

export function WritebackForm({ current }: { current: WritebackFormValue }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tagsOn, setTagsOn] = useState(current.shopify_writeback_tags);
  const [fulfillmentOn, setFulfillmentOn] = useState(
    current.shopify_writeback_fulfillment,
  );
  const [notifyOn, setNotifyOn] = useState(
    current.shopify_fulfillment_notify_customer,
  );
  const [inventoryOn, setInventoryOn] = useState(
    current.shopify_writeback_inventory,
  );
  const [catalogOn, setCatalogOn] = useState(current.catalog_sync_to_shopify);
  const [tagShip, setTagShip] = useState(current.shopify_tag_ship);
  const [tagStop, setTagStop] = useState(current.shopify_tag_stop);
  const [tagPacked, setTagPacked] = useState(current.shopify_tag_packed);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveWritebackAction(fd);
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Shopify",
          message: "Rückschreiben gespeichert.",
        });
        router.refresh();
      } else {
        dispatchAdminJobError({ title: "Shopify", message: res.error });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Toggle
        name="shopify_writeback_tags"
        checked={tagsOn}
        onChange={setTagsOn}
        title="Status-Tags"
        body="Beim Wechsel auf versandbereit, Wartestatus oder gepackt wird der passende Tag an die Shopify-Bestellung geschrieben."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <TagField
          id="shopify_tag_ship"
          label="Versandbereit"
          hint="Auch während der Kommissionierung."
          value={tagShip}
          placeholder={DEFAULT_SHOPIFY_TAG_SHIP}
          muted={!tagsOn}
          onChange={setTagShip}
        />
        <TagField
          id="shopify_tag_stop"
          label="Wartet auf Bestand"
          hint="Leer lassen = kein Tag."
          value={tagStop}
          placeholder={DEFAULT_SHOPIFY_TAG_STOP}
          muted={!tagsOn}
          onChange={setTagStop}
        />
        <TagField
          id="shopify_tag_packed"
          label="Gepackt"
          hint="Ersetzt die beiden anderen Tags."
          value={tagPacked}
          placeholder={DEFAULT_SHOPIFY_TAG_PACKED}
          muted={!tagsOn}
          onChange={setTagPacked}
        />
      </div>

      <Toggle
        name="shopify_writeback_fulfillment"
        checked={fulfillmentOn}
        onChange={setFulfillmentOn}
        title="Bestellstatus (Fulfillment)"
        body="Beim Packen wird die Bestellung in Shopify als erfüllt markiert, inklusive Sendungsnummer falls vorhanden."
      />

      <label
        className={`flex cursor-pointer items-start gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 ${
          fulfillmentOn ? "" : "opacity-60"
        }`}
      >
        <input
          type="checkbox"
          name="shopify_fulfillment_notify_customer"
          value="1"
          checked={notifyOn}
          onChange={(e) => setNotifyOn(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-zinc-300"
        />
        <span>
          <span className="block text-sm font-semibold text-brand-navy">
            Kunden über den Versand informieren
          </span>
          <span className="mt-1 block text-xs text-brand-navy/70">
            Shopify schickt die Versandmail, wenn das Fulfillment angelegt wird.
          </span>
        </span>
      </label>

      <Toggle
        name="shopify_writeback_inventory"
        checked={inventoryOn}
        onChange={setInventoryOn}
        title="Bestand"
        body={
          current.inventory_source === "APP"
            ? "Mengen nach Wareneingang, Korrektur und Packen an Shopify schreiben."
            : "Aus, solange Shopify den Bestand führt. Einschalten wirkt erst, wenn unter Bestand die Lager-App die Menge führt."
        }
      />

      <Toggle
        name="catalog_sync_to_shopify"
        checked={catalogOn}
        onChange={setCatalogOn}
        title="Produktdaten"
        body="Standard für den Produkt-Editor. Einzelne Speichervorgänge können den Sync pro Vorgang überschreiben."
      />

      <button
        type="submit"
        disabled={pending}
        className="btn-primary text-sm disabled:opacity-50"
      >
        {pending ? "Speichern…" : "Speichern"}
      </button>
    </form>
  );
}

function Toggle({
  name,
  checked,
  onChange,
  title,
  body,
}: {
  name: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  body: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-4">
      <input
        type="checkbox"
        name={name}
        value="1"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-zinc-300"
      />
      <span>
        <span className="block text-sm font-semibold text-brand-navy">
          {title}
        </span>
        <span className="mt-1 block text-xs text-brand-navy/70">{body}</span>
      </span>
    </label>
  );
}

function TagField({
  id,
  label,
  hint,
  value,
  placeholder,
  muted,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  muted: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <div className={muted ? "opacity-60" : undefined}>
      <label
        htmlFor={id}
        className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60"
      >
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm"
      />
      <p className="mt-1 text-[11px] text-brand-navy/50">{hint}</p>
    </div>
  );
}
