"use client";

import { useTranslations } from "next-intl";
import type { VariantRow } from "./product-accordion";
import { VariantBatchPanel } from "./variant-batch-panel";
import { VariantInventoryPanel } from "./variant-inventory-panel";
import {
  DEFAULT_COLUMN_VISIBILITY,
  type ColumnVisibility,
} from "./columns";
import type { LocationOption } from "@/app/admin/_components/location-fields";
import type { ProductEditorPayload } from "@/server/catalog/editor-types";

type MediaItem = ProductEditorPayload["input"]["media"][number];

export type VariantImageEditorProps = {
  media: MediaItem[];
  onMediaChange: (next: MediaItem[]) => void;
  getVariantImage: (variantId: string) => {
    image_url: string | null;
    image_media_id: string | null;
  };
  onVariantImageChange: (
    variantId: string,
    patch: { image_url: string | null; image_media_id: string | null },
  ) => void;
};

function formatPrice(cents: number | null, currency: string | null): string {
  if (cents == null) return "—";
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: currency ?? "EUR",
    }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

export function ProductInventorySection({
  batchesEnabled,
  rows,
  locations,
  defaultLocationId,
  columnVisibility = DEFAULT_COLUMN_VISIBILITY,
  variantImageEditor,
}: {
  batchesEnabled: boolean;
  rows: VariantRow[];
  locations: LocationOption[];
  defaultLocationId: string | null;
  columnVisibility?: ColumnVisibility;
  variantImageEditor?: VariantImageEditorProps;
}) {
  const t = useTranslations("productEditor");

  if (rows.length === 0) return null;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-brand-navy">
        {t("sectionInventory")}
      </h2>
      <p className="mt-1 text-sm text-brand-navy/60">{t("sectionInventoryHint")}</p>
      <div className="mt-4 space-y-4">
        {rows.map((variant) => {
          const priceLabel = formatPrice(variant.priceCents, variant.currency);
          const editorImage = variantImageEditor?.getVariantImage(variant.id);
          const imageUrl =
            editorImage?.image_url ?? variant.imageUrl ?? null;
          const imageMediaId = editorImage?.image_media_id ?? null;

          const imageEditor = variantImageEditor
            ? {
                media: variantImageEditor.media,
                imageUrl,
                imageMediaId,
                onMediaChange: variantImageEditor.onMediaChange,
                onImageChange: (patch: {
                  image_url: string | null;
                  image_media_id: string | null;
                }) => variantImageEditor.onVariantImageChange(variant.id, patch),
              }
            : undefined;

          return batchesEnabled ? (
            <VariantBatchPanel
              key={variant.id}
              variant={variant}
              priceLabel={priceLabel}
              cols={columnVisibility}
              locations={locations}
              defaultLocationId={defaultLocationId}
              imageEditor={imageEditor}
            />
          ) : (
            <VariantInventoryPanel
              key={variant.id}
              variant={variant}
              priceLabel={priceLabel}
              locations={locations}
              defaultLocationId={defaultLocationId}
              imageEditor={imageEditor}
              displayImageUrl={imageUrl}
            />
          );
        })}
      </div>
    </section>
  );
}
