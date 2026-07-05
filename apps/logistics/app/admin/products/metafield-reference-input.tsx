"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  isListMetafieldType,
  parseReferenceGids,
  referenceKindForMetafieldType,
  serializeReferenceGids,
} from "@/lib/metafield-editor";
import {
  resolveMetafieldReferencesAction,
  searchMetafieldReferencesAction,
} from "./metafield-reference-actions";
import type { MetafieldReferenceOption } from "@/server/shopify/metafield-references";

const chipClass =
  "inline-flex items-center gap-1 rounded-full bg-brand-cream px-2 py-0.5 text-xs text-brand-navy ring-1 ring-zinc-200";
const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

export function MetafieldReferenceInput({
  type,
  storageValue,
  metaobjectDefinitionId,
  onChange,
}: {
  type: string;
  storageValue: string;
  metaobjectDefinitionId?: string | null;
  onChange: (storageValue: string) => void;
}) {
  const t = useTranslations("productEditor");
  const kind = referenceKindForMetafieldType(type);
  const selectedGids = useMemo(
    () => parseReferenceGids(storageValue),
    [storageValue],
  );
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<MetafieldReferenceOption[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const listMode = isListMetafieldType(type);

  useEffect(() => {
    if (selectedGids.length === 0) {
      setLabels({});
      return;
    }
    let cancelled = false;
    resolveMetafieldReferencesAction(selectedGids).then((res) => {
      if (cancelled || !res.ok) return;
      setLabels(res.labels);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedGids.join("|")]);

  useEffect(() => {
    if (!open || !kind || kind === "mixed") return;
    if (query.trim().length < 1) {
      setOptions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      startTransition(async () => {
        const res = await searchMetafieldReferencesAction({
          kind,
          query,
          metaobjectDefinitionId,
        });
        if (res.ok) {
          setOptions(
            res.options.filter((opt) => !selectedGids.includes(opt.gid)),
          );
        }
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, open, kind, metaobjectDefinitionId]);

  function addReference(gid: string) {
    const next = listMode
      ? [...selectedGids.filter((g) => g !== gid), gid]
      : [gid];
    onChange(serializeReferenceGids(type, next));
    setQuery("");
    setOpen(false);
  }

  function removeReference(gid: string) {
    onChange(
      serializeReferenceGids(
        type,
        selectedGids.filter((g) => g !== gid),
      ),
    );
  }

  if (!kind || kind === "mixed") {
    return (
      <p className="text-xs text-brand-navy/50">
        {t("metafieldReferenceUnsupported")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {selectedGids.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedGids.map((gid) => (
            <span key={gid} className={chipClass}>
              <span>{labels[gid] ?? t("metafieldReferenceLoading")}</span>
              <button
                type="button"
                onClick={() => removeReference(gid)}
                className="text-brand-burgundy"
                aria-label={t("remove")}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-brand-navy/45">{t("metafieldReferenceEmpty")}</p>
      )}

      {(listMode || selectedGids.length === 0) && (
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            className={inputClass}
            placeholder={t("metafieldReferenceSearch")}
          />
          {open && (options.length > 0 || pending) ? (
            <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg">
              {pending ? (
                <p className="px-3 py-2 text-xs text-brand-navy/50">…</p>
              ) : (
                options.map((opt) => (
                  <button
                    key={opt.gid}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-cream"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => addReference(opt.gid)}
                  >
                    <span className="font-medium text-brand-navy">{opt.label}</span>
                    {opt.subtitle ? (
                      <span className="mt-0.5 block text-xs text-brand-navy/50">
                        {opt.subtitle}
                      </span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
