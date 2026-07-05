"use client";

import { useTranslations } from "next-intl";
import type { ProductEditorMetafield } from "@/server/catalog/editor-types";
import {
  isBooleanMetafieldType,
  isListMetafieldType,
  isMultiLineMetafieldType,
  isNumberMetafieldType,
  isReferenceMetafieldType,
  metafieldDisplayLabel,
  metafieldTechnicalName,
  parseMetafieldDisplayValue,
  serializeMetafieldStorageValue,
} from "@/lib/metafield-editor";
import { MetafieldReferenceInput } from "./metafield-reference-input";

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

export function ProductMetafieldsPanel({
  metafields,
  onChange,
}: {
  metafields: ProductEditorMetafield[];
  onChange: (next: ProductEditorMetafield[]) => void;
}) {
  const t = useTranslations("productEditor");

  if (metafields.length === 0) {
    return (
      <p className="text-sm text-brand-navy/60">{t("metafieldsEmpty")}</p>
    );
  }

  function updateField(index: number, value: string) {
    const next = [...metafields];
    const mf = next[index]!;
    next[index] = {
      ...mf,
      value: isReferenceMetafieldType(mf.type)
        ? value
        : serializeMetafieldStorageValue(mf.type, value),
    };
    onChange(next);
  }

  return (
    <div className="divide-y divide-zinc-100">
      {metafields.map((mf, index) => {
        const label = metafieldDisplayLabel(mf);
        const technical = metafieldTechnicalName(mf);
        const display = parseMetafieldDisplayValue(mf.type, mf.value);

        return (
          <div
            key={`${mf.namespace}.${mf.key}-${index}`}
            className="grid grid-cols-1 items-start gap-x-6 gap-y-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(140px,28%)_1fr]"
          >
            <div className="min-w-0 pt-1.5">
              <p className="text-sm font-medium text-brand-navy">{label}</p>
              <p className="mt-0.5 font-mono text-xs text-brand-navy/45">
                {technical}
              </p>
            </div>
            <div className="min-w-0">
              <MetafieldInput
                type={mf.type}
                displayValue={display}
                storageValue={mf.value}
                metaobjectDefinitionId={mf.metaobject_definition_id}
                onChange={(value) => updateField(index, value)}
                listHint={t("metafieldListHint")}
                placeholder={t("metafieldValue")}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MetafieldInput({
  type,
  displayValue,
  storageValue,
  metaobjectDefinitionId,
  onChange,
  listHint,
  placeholder,
}: {
  type: string;
  displayValue: string;
  storageValue: string;
  metaobjectDefinitionId?: string | null;
  onChange: (value: string) => void;
  listHint: string;
  placeholder: string;
}) {
  const t = useTranslations("productEditor");

  if (isReferenceMetafieldType(type)) {
    return (
      <MetafieldReferenceInput
        type={type}
        storageValue={storageValue}
        metaobjectDefinitionId={metaobjectDefinitionId}
        onChange={onChange}
      />
    );
  }

  if (isBooleanMetafieldType(type)) {
    return (
      <label className="flex items-center gap-2 text-sm text-brand-navy">
        <input
          type="checkbox"
          checked={displayValue === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          className="h-4 w-4 rounded border-zinc-300"
        />
        <span>{displayValue === "true" ? t("metafieldYes") : t("metafieldNo")}</span>
      </label>
    );
  }

  if (isListMetafieldType(type)) {
    return (
      <input
        type="text"
        value={displayValue}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
        placeholder={listHint}
      />
    );
  }

  if (isMultiLineMetafieldType(type)) {
    return (
      <textarea
        rows={3}
        value={displayValue}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} resize-y`}
        placeholder={placeholder}
      />
    );
  }

  if (isNumberMetafieldType(type)) {
    return (
      <input
        type="number"
        step={type.includes("decimal") ? "any" : "1"}
        value={displayValue}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    );
  }

  return (
    <input
      type="text"
      value={displayValue}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
      placeholder={placeholder}
    />
  );
}
