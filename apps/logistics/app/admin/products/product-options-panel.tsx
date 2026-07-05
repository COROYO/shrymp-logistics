"use client";

import { useTranslations } from "next-intl";
import type { ProductEditorFormInput } from "@/server/catalog/editor-types";
import { MAX_PRODUCT_OPTIONS } from "@/server/catalog/variant-matrix";
import { OptionValuesPillInput } from "./option-values-pill-input";

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

type OptionRow = ProductEditorFormInput["options"][number];

export function ProductOptionsPanel({
  options,
  onChange,
  onGenerateVariants,
  onGenerateVariantsFromOptions,
}: {
  options: OptionRow[];
  onChange: (options: OptionRow[]) => void;
  onGenerateVariants: () => void;
  onGenerateVariantsFromOptions?: (options: OptionRow[]) => void;
}) {
  const t = useTranslations("productEditor");

  function updateOption(index: number, patch: Partial<OptionRow>) {
    const next = options.map((o, i) => (i === index ? { ...o, ...patch } : o));
    onChange(next);
    if ("values" in patch && onGenerateVariantsFromOptions) {
      onGenerateVariantsFromOptions(next);
    }
  }

  function addOption() {
    if (options.length >= MAX_PRODUCT_OPTIONS) return;
    onChange([
      ...options,
      {
        name: "",
        position: options.length + 1,
        values: [],
      },
    ]);
  }

  function removeOption(index: number) {
    onChange(
      options
        .filter((_, i) => i !== index)
        .map((o, i) => ({ ...o, position: i + 1 })),
    );
  }

  return (
    <div className="space-y-4">
      {options.length === 0 ? (
        <p className="text-sm text-brand-navy/60">{t("optionsEmpty")}</p>
      ) : null}

      {options.map((option, index) => (
        <div
          key={index}
          className="rounded-md border border-zinc-200 bg-zinc-50/80 p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
                  {t("optionName")}
                </span>
                <input
                  value={option.name}
                  onChange={(e) =>
                    updateOption(index, { name: e.target.value })
                  }
                  className={`${inputClass} mt-1.5`}
                  placeholder={t("optionNamePlaceholder")}
                />
              </label>
              <div className="block sm:col-span-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-navy/60">
                  {t("optionValues")}
                </span>
                <OptionValuesPillInput
                  values={option.values}
                  onChange={(values) => updateOption(index, { values })}
                  placeholder={t("optionValuesPlaceholder")}
                  removeLabel={t("remove")}
                />
                <p className="mt-1 text-xs text-brand-navy/45">
                  {t("optionValuesHint")}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => removeOption(index)}
              className="mt-6 text-xs text-brand-burgundy"
            >
              {t("remove")}
            </button>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        {options.length < MAX_PRODUCT_OPTIONS ? (
          <button
            type="button"
            onClick={addOption}
            className="text-sm font-semibold text-brand-burgundy"
          >
            {t("addOption")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onGenerateVariants}
          className="rounded-md border border-brand-navy/20 bg-white px-3 py-2 text-sm font-semibold text-brand-navy transition hover:bg-brand-cream"
        >
          {t("generateVariants")}
        </button>
      </div>
    </div>
  );
}

export function variantOptionColumns(
  options: OptionRow[],
): Array<{ key: "option1" | "option2" | "option3"; label: string }> {
  return options.slice(0, MAX_PRODUCT_OPTIONS).map((o, i) => ({
    key: (["option1", "option2", "option3"] as const)[i],
    label: o.name.trim() || `Option ${i + 1}`,
  }));
}
