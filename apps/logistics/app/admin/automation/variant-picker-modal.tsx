"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Modal } from "@/app/_components/modal";
import {
  listGiftVariantsAction,
  type GiftVariantOption,
} from "./actions";

export function VariantPickerModal({
  open,
  onClose,
  onSelect,
  selectedId,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (variant: GiftVariantOption) => void;
  selectedId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [variants, setVariants] = useState<GiftVariantOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    if (variants) return;
    startTransition(async () => {
      const res = await listGiftVariantsAction();
      if (res.ok) {
        setVariants(res.variants);
        setError(null);
      } else {
        setError(res.error);
      }
    });
  }, [open, variants]);

  const filtered = useMemo(() => {
    const list = variants ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((v) => {
      const hay = `${v.productTitle} ${v.variantTitle} ${v.sku ?? ""} ${v.variantId}`.toLowerCase();
      return hay.includes(q);
    });
  }, [variants, query]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Variante wählen"
      description="Gratisbeigabe aus dem Produktkatalog auswählen."
      size="lg"
    >
      <div className="space-y-4">
        <input
          type="search"
          className="input-sm w-full"
          placeholder="Suchen nach Produkt, Variante, SKU…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : null}

        {pending && !variants ? (
          <p className="py-8 text-center text-sm text-brand-navy/50">
            Produkte werden geladen…
          </p>
        ) : null}

        {variants ? (
          <div className="max-h-[min(50vh,420px)] overflow-y-auto rounded-md border border-zinc-200">
            {filtered.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-brand-navy/50">
                Keine Varianten gefunden.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {filtered.map((v) => {
                  const selected = v.variantId === selectedId;
                  const title =
                    v.variantTitle && v.variantTitle !== "Default Title"
                      ? `${v.productTitle} — ${v.variantTitle}`
                      : v.productTitle;
                  return (
                    <li key={v.variantId}>
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(v);
                          onClose();
                        }}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-brand-navy/5 ${
                          selected ? "bg-brand-navy/5" : ""
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-brand-navy">
                            {title}
                          </span>
                          <span className="mt-0.5 block font-mono text-[11px] text-brand-navy/50">
                            {v.sku ? `SKU ${v.sku}` : `ID ${v.variantId}`}
                          </span>
                        </span>
                        {selected ? (
                          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-brand-burgundy">
                            Gewählt
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export function formatVariantLabel(v: {
  productTitle: string;
  variantTitle: string;
  sku: string | null;
}): string {
  const title =
    v.variantTitle && v.variantTitle !== "Default Title"
      ? `${v.productTitle} — ${v.variantTitle}`
      : v.productTitle;
  return v.sku ? `${title} (${v.sku})` : title;
}
