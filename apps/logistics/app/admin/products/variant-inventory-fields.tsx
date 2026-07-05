"use client";

import { useTranslations } from "next-intl";
import type { ProductEditorVariant } from "@/server/catalog/editor-types";
import { MoneyInput } from "./money-input";

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

export function VariantInventoryFields({
  variant,
  onChange,
  layout = "grid",
  stockEditable = true,
}: {
  variant: ProductEditorVariant;
  onChange: (next: ProductEditorVariant) => void;
  layout?: "grid" | "stack";
  /** False when stock is managed via Lagerbestand / Chargen panels. */
  stockEditable?: boolean;
}) {
  const t = useTranslations("productEditor");
  const wrapClass =
    layout === "grid" ? "grid gap-4 sm:grid-cols-2" : "space-y-4";

  return (
    <div className={wrapClass}>
      {stockEditable ? (
        <Field label={t("variantOnHand")}>
          <input
            type="number"
            min={0}
            step={1}
            value={variant.on_hand}
            disabled={!variant.inventory_tracked}
            onChange={(e) =>
              onChange({
                ...variant,
                on_hand: e.target.value ? Number(e.target.value) : 0,
              })
            }
            className={`${inputClass} font-mono text-xs`}
          />
        </Field>
      ) : null}
      <Field label={t("variantUnitCost")}>
        <MoneyInput
          valueCents={variant.unit_cost_cents}
          onChange={(unit_cost_cents) =>
            onChange({ ...variant, unit_cost_cents })
          }
          className={inputClass}
        />
      </Field>
      <Field label={t("variantInventoryTracked")}>
        <label className="flex items-center gap-2 text-sm text-brand-navy">
          <input
            type="checkbox"
            checked={variant.inventory_tracked}
            onChange={(e) =>
              onChange({ ...variant, inventory_tracked: e.target.checked })
            }
            className="h-4 w-4 rounded border-zinc-300"
          />
          <span>{t("variantInventoryTrackedHint")}</span>
        </label>
      </Field>
      <Field label={t("variantContinueSelling")}>
        <label className="flex items-center gap-2 text-sm text-brand-navy">
          <input
            type="checkbox"
            checked={variant.inventory_policy === "CONTINUE"}
            onChange={(e) =>
              onChange({
                ...variant,
                inventory_policy: e.target.checked ? "CONTINUE" : "DENY",
              })
            }
            className="h-4 w-4 rounded border-zinc-300"
          />
          <span>{t("variantContinueSellingHint")}</span>
        </label>
      </Field>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
