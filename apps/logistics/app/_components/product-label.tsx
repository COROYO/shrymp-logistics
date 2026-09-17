import { parseEan } from "@/lib/barcode/ean";
import { Barcode128 } from "./barcode-128";
import { BarcodeEan } from "./barcode-ean";

/**
 * A single printable product label: title, optional variant + price, and a
 * barcode. Valid EAN-8/13 (or UPC-A) on `barcode` → native EAN symbology;
 * otherwise Code 128 of the SKU. Matches warehouse scan resolution
 * (barcode first, then sku).
 */
export function ProductLabel({
  productTitle,
  variantTitle,
  sku,
  barcode,
  priceLabel,
  showPrice = true,
  showSku = true,
}: {
  productTitle: string;
  variantTitle?: string | null;
  sku?: string | null;
  barcode?: string | null;
  priceLabel?: string | null;
  showPrice?: boolean;
  showSku?: boolean;
}) {
  const ean = barcode ? parseEan(barcode) : null;
  const skuCode = (sku || "").trim();
  const hasVariant =
    variantTitle && variantTitle !== "Default Title" && variantTitle !== "—";

  return (
    <div className="sc-product-label flex flex-col rounded-md border border-zinc-300 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="line-clamp-2 text-sm font-semibold leading-tight text-black">
            {productTitle}
          </div>
          {hasVariant ? (
            <div className="truncate text-xs text-zinc-600">{variantTitle}</div>
          ) : null}
        </div>
        {showPrice && priceLabel ? (
          <div className="shrink-0 text-sm font-bold text-black">{priceLabel}</div>
        ) : null}
      </div>

      <div className="mt-2 flex items-end justify-center">
        {ean ? (
          <BarcodeEan parsed={ean} height={44} moduleWidth={1.3} showValue />
        ) : skuCode ? (
          <Barcode128 value={skuCode} height={44} moduleWidth={1.3} showValue />
        ) : (
          <span className="py-3 text-[11px] font-medium text-amber-700">
            {showSku ? "kein Barcode / SKU" : ""}
          </span>
        )}
      </div>

      {showSku && skuCode && ean ? (
        <div className="mt-1 text-center font-mono text-[10px] text-zinc-500">
          SKU {skuCode}
        </div>
      ) : null}
    </div>
  );
}
