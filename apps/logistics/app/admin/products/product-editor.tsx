"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";
import { buildVariantsFromOptions } from "@/server/catalog/variant-matrix";
import {
  hasRealProductOptions,
  normalizeProductEditorInput,
} from "@/server/catalog/shopify-catalog-normalize";
import { saveProductAction } from "./catalog-actions";
import { MoneyInput } from "./money-input";
import { ProductMediaGallery } from "./product-media-gallery";
import { ProductHtmlEditor } from "./product-html-editor";
import { VariantInventoryFields } from "./variant-inventory-fields";
import { ProductMetafieldsPanel } from "./product-metafields-panel";
import { ProductInventorySection } from "./product-inventory-section";
import {
  ProductOptionsPanel,
  variantOptionColumns,
} from "./product-options-panel";
import type { ProductEditorPayload } from "@/server/catalog/editor-types";

type EditorState = ProductEditorPayload["input"] & {
  sync_to_shopify: boolean;
};

function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20";

type VariantImageState = {
  image_url: string | null;
  image_media_id: string | null;
};

function buildInitialVariantImages(
  payload: ProductEditorPayload,
): Record<string, VariantImageState> {
  const out: Record<string, VariantImageState> = {};
  for (const row of payload.variantInventory) {
    const editorVariant = payload.input.variants.find((v) => v.id === row.id);
    out[row.id] = {
      image_url: editorVariant?.image_url ?? row.imageUrl ?? null,
      image_media_id: editorVariant?.image_media_id ?? null,
    };
  }
  for (const variant of payload.input.variants) {
    if (variant.id && !out[variant.id]) {
      out[variant.id] = {
        image_url: variant.image_url ?? null,
        image_media_id: variant.image_media_id ?? null,
      };
    }
  }
  return out;
}

export function ProductEditor({
  payload,
}: {
  payload: ProductEditorPayload;
}) {
  const t = useTranslations("productEditor");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<EditorState>(() => ({
    ...normalizeProductEditorInput(payload.input),
    sync_to_shopify: payload.defaultSyncToShopify,
  }));
  const [variantImagesById, setVariantImagesById] = useState<
    Record<string, VariantImageState>
  >(() => buildInitialVariantImages(payload));
  const [handleTouched, setHandleTouched] = useState(
    payload.isNew ? false : true,
  );

  const collectionSet = useMemo(
    () => new Set(state.collection_ids),
    [state.collection_ids],
  );
  const optionColumns = useMemo(
    () => variantOptionColumns(state.options),
    [state.options],
  );
  const isSimpleProduct = !hasRealProductOptions(state.options);
  const simpleVariant = state.variants[0];
  const showInventoryPanels =
    !payload.isNew && payload.variantInventory.length > 0;

  function generateVariants() {
    setState((cur) => ({
      ...cur,
      variants: buildVariantsFromOptions(cur.options, cur.variants),
    }));
  }

  function update<K extends keyof EditorState>(key: K, value: EditorState[K]) {
    setState((cur) => ({ ...cur, [key]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveProductAction({
        ...state,
        product_id: payload.productId || undefined,
        handle: state.handle.trim() || slugify(state.title),
        tags: state.tags.map((tag) => tag.trim()).filter(Boolean),
        media: state.media.filter(
          (m) => m.url.trim().length > 0 && m.url !== "https://",
        ),
        variants: buildVariantsFromOptions(
          state.options,
          state.variants.map((v) => {
            if (!v.id) return v;
            const img = variantImagesById[v.id];
            return img ? { ...v, ...img } : v;
          }),
        ),
      });
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: t("saveSuccessTitle"),
          message: res.syncedToShopify
            ? t("saveSuccessSynced")
            : t("saveSuccessLocal"),
        });
        if (payload.isNew) {
          router.replace(`/admin/products/${res.productId}`);
        } else {
          router.refresh();
        }
      } else {
        dispatchAdminJobError({
          title: t("saveErrorTitle"),
          message:
            res.code === "missing_scope"
              ? t("missingScope")
              : res.error,
        });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/admin/products"
            className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-navy/60 transition hover:text-brand-burgundy"
          >
            {t("back")}
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-brand-navy">
            {payload.isNew ? t("newTitle") : state.title || t("editTitle")}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={state.sync_to_shopify}
              onChange={(e) => update("sync_to_shopify", e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300"
            />
            <span>{t("syncToShopify")}</span>
          </label>
          <button
            type="submit"
            disabled={pending}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {pending ? t("saving") : t("save")}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Section title={t("sectionBasics")}>
            <Field label={t("fieldTitle")}>
              <input
                required
                value={state.title}
                onChange={(e) => {
                  const title = e.target.value;
                  setState((cur) => ({
                    ...cur,
                    title,
                    handle: handleTouched ? cur.handle : slugify(title),
                  }));
                }}
                className={inputClass}
              />
            </Field>
            <Field label={t("fieldDescription")}>
              <ProductHtmlEditor
                value={state.description_html ?? ""}
                onChange={(html) => update("description_html", html || null)}
              />
            </Field>
          </Section>

          <Section title={t("sectionMedia")}>
            <ProductMediaGallery
              media={state.media}
              onChange={(media) => update("media", media)}
            />
          </Section>

          <Section title={t("sectionOptions")}>
            <ProductOptionsPanel
              options={state.options}
              onChange={(options) => update("options", options)}
              onGenerateVariants={generateVariants}
              onGenerateVariantsFromOptions={(options) => {
                setState((cur) => ({
                  ...cur,
                  options,
                  variants: buildVariantsFromOptions(options, cur.variants),
                }));
              }}
            />
          </Section>

          {isSimpleProduct && simpleVariant ? (
            <Section title={t("sectionSimpleVariant")}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("variantSku")}>
                  <input
                    value={simpleVariant.sku ?? ""}
                    onChange={(e) => {
                      const variants = [...state.variants];
                      variants[0] = {
                        ...variants[0],
                        sku: e.target.value || null,
                      };
                      update("variants", variants);
                    }}
                    className={`${inputClass} font-mono text-xs`}
                  />
                </Field>
                <Field label={t("variantBarcode")}>
                  <input
                    value={simpleVariant.barcode ?? ""}
                    onChange={(e) => {
                      const variants = [...state.variants];
                      variants[0] = {
                        ...variants[0],
                        barcode: e.target.value || null,
                      };
                      update("variants", variants);
                    }}
                    className={`${inputClass} font-mono text-xs`}
                  />
                </Field>
                <Field label={t("variantPrice")}>
                  <MoneyInput
                    valueCents={simpleVariant.price_cents}
                    onChange={(price_cents) => {
                      const variants = [...state.variants];
                      variants[0] = { ...variants[0], price_cents };
                      update("variants", variants);
                    }}
                    className={inputClass}
                  />
                </Field>
                <Field label={t("variantCompareAt")}>
                  <MoneyInput
                    valueCents={simpleVariant.compare_at_price_cents}
                    onChange={(compare_at_price_cents) => {
                      const variants = [...state.variants];
                      variants[0] = {
                        ...variants[0],
                        compare_at_price_cents,
                      };
                      update("variants", variants);
                    }}
                    className={inputClass}
                  />
                </Field>
              </div>
              <VariantInventoryFields
                variant={simpleVariant}
                stockEditable={payload.isNew}
                onChange={(next) => {
                  const variants = [...state.variants];
                  variants[0] = next;
                  update("variants", variants);
                }}
              />
            </Section>
          ) : null}

          {!isSimpleProduct ? (
          <Section title={t("sectionVariants")}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-[0.12em] text-brand-navy/60">
                    {optionColumns.map((col) => (
                      <th key={col.key} className="px-2 py-2">
                        {col.label}
                      </th>
                    ))}
                    <th className="px-2 py-2">{t("variantTitle")}</th>
                    <th className="px-2 py-2">{t("variantSku")}</th>
                    <th className="px-2 py-2">{t("variantBarcode")}</th>
                    <th className="px-2 py-2">{t("variantPrice")}</th>
                    <th className="px-2 py-2">{t("variantCompareAt")}</th>
                    {payload.isNew ? (
                      <th className="px-2 py-2">{t("variantOnHand")}</th>
                    ) : null}
                    <th className="px-2 py-2">{t("variantUnitCost")}</th>
                    <th className="px-2 py-2">{t("variantInventoryTracked")}</th>
                    <th className="px-2 py-2">{t("variantContinueSelling")}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.variants.map((variant, index) => (
                    <tr key={variant.id ?? index} className="border-b border-zinc-100">
                      {optionColumns.map((col) => (
                        <td key={col.key} className="px-2 py-2 text-sm text-brand-navy/80">
                          {variant[col.key] ?? "—"}
                        </td>
                      ))}
                      <td className="px-2 py-2">
                        <input
                          value={variant.title}
                          onChange={(e) => {
                            const variants = [...state.variants];
                            variants[index] = {
                              ...variants[index],
                              title: e.target.value,
                            };
                            update("variants", variants);
                          }}
                          className={inputClass}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={variant.sku ?? ""}
                          onChange={(e) => {
                            const variants = [...state.variants];
                            variants[index] = {
                              ...variants[index],
                              sku: e.target.value || null,
                            };
                            update("variants", variants);
                          }}
                          className={`${inputClass} font-mono text-xs`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={variant.barcode ?? ""}
                          onChange={(e) => {
                            const variants = [...state.variants];
                            variants[index] = {
                              ...variants[index],
                              barcode: e.target.value || null,
                            };
                            update("variants", variants);
                          }}
                          className={`${inputClass} font-mono text-xs`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <MoneyInput
                          valueCents={variant.price_cents}
                          onChange={(price_cents) => {
                            const variants = [...state.variants];
                            variants[index] = {
                              ...variants[index],
                              price_cents,
                            };
                            update("variants", variants);
                          }}
                          className={`${inputClass} w-24`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <MoneyInput
                          valueCents={variant.compare_at_price_cents}
                          onChange={(compare_at_price_cents) => {
                            const variants = [...state.variants];
                            variants[index] = {
                              ...variants[index],
                              compare_at_price_cents,
                            };
                            update("variants", variants);
                          }}
                          className={`${inputClass} w-24`}
                        />
                      </td>
                      {payload.isNew ? (
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={variant.on_hand}
                            disabled={!variant.inventory_tracked}
                            onChange={(e) => {
                              const variants = [...state.variants];
                              variants[index] = {
                                ...variants[index],
                                on_hand: e.target.value
                                  ? Number(e.target.value)
                                  : 0,
                              };
                              update("variants", variants);
                            }}
                            className={`${inputClass} font-mono text-xs w-20`}
                          />
                        </td>
                      ) : null}
                      <td className="px-2 py-2">
                        <MoneyInput
                          valueCents={variant.unit_cost_cents}
                          onChange={(unit_cost_cents) => {
                            const variants = [...state.variants];
                            variants[index] = {
                              ...variants[index],
                              unit_cost_cents,
                            };
                            update("variants", variants);
                          }}
                          className={`${inputClass} w-24`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={variant.inventory_tracked}
                          onChange={(e) => {
                            const variants = [...state.variants];
                            variants[index] = {
                              ...variants[index],
                              inventory_tracked: e.target.checked,
                            };
                            update("variants", variants);
                          }}
                          className="h-4 w-4 rounded border-zinc-300"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={variant.inventory_policy === "CONTINUE"}
                          onChange={(e) => {
                            const variants = [...state.variants];
                            variants[index] = {
                              ...variants[index],
                              inventory_policy: e.target.checked
                                ? "CONTINUE"
                                : "DENY",
                            };
                            update("variants", variants);
                          }}
                          className="h-4 w-4 rounded border-zinc-300"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() =>
                update("variants", [
                  ...state.variants,
                  {
                    title: "",
                    sku: null,
                    barcode: null,
                    price_cents: null,
                    compare_at_price_cents: null,
                    image_url: null,
                    image_media_id: null,
                    option1: null,
                    option2: null,
                    option3: null,
                    position: state.variants.length,
                    on_hand: 0,
                    inventory_tracked: true,
                    inventory_policy: "DENY",
                    unit_cost_cents: null,
                  },
                ])
              }
              className="mt-3 text-sm font-semibold text-brand-burgundy"
            >
              {t("addVariant")}
            </button>
          </Section>
          ) : null}

          {showInventoryPanels ? (
            <ProductInventorySection
              batchesEnabled={payload.batchesEnabled}
              rows={payload.variantInventory}
              locations={payload.inventoryLocations}
              defaultLocationId={payload.defaultLocationId}
              variantImageEditor={{
                media: state.media,
                onMediaChange: (media) => update("media", media),
                getVariantImage: (variantId) =>
                  variantImagesById[variantId] ?? {
                    image_url:
                      state.variants.find((v) => v.id === variantId)
                        ?.image_url ?? null,
                    image_media_id:
                      state.variants.find((v) => v.id === variantId)
                        ?.image_media_id ?? null,
                  },
                onVariantImageChange: (variantId, patch) => {
                  setVariantImagesById((cur) => ({
                    ...cur,
                    [variantId]: patch,
                  }));
                  setState((cur) => ({
                    ...cur,
                    variants: cur.variants.map((v) =>
                      v.id === variantId ? { ...v, ...patch } : v,
                    ),
                  }));
                },
              }}
            />
          ) : null}

          <Section title={t("sectionMetafields")}>
            <ProductMetafieldsPanel
              metafields={state.metafields}
              onChange={(metafields) => update("metafields", metafields)}
            />
          </Section>
        </div>

        <div className="space-y-6">
          <Section title={t("sectionStatus")}>
            <Field label={t("fieldStatus")}>
              <select
                value={state.status}
                onChange={(e) =>
                  update(
                    "status",
                    e.target.value as EditorState["status"],
                  )
                }
                className={inputClass}
              >
                <option value="ACTIVE">{t("statusActive")}</option>
                <option value="DRAFT">{t("statusDraft")}</option>
                <option value="ARCHIVED">{t("statusArchived")}</option>
              </select>
            </Field>
            <Field label={t("fieldHandle")}>
              <input
                required
                value={state.handle}
                onChange={(e) => {
                  setHandleTouched(true);
                  update("handle", e.target.value);
                }}
                className={`${inputClass} font-mono text-xs`}
              />
            </Field>
          </Section>

          <Section title={t("sectionOrganization")}>
            <Field label={t("fieldVendor")}>
              <input
                value={state.vendor ?? ""}
                onChange={(e) => update("vendor", e.target.value || null)}
                className={inputClass}
              />
            </Field>
            <Field label={t("fieldProductType")}>
              <input
                value={state.product_type ?? ""}
                onChange={(e) =>
                  update("product_type", e.target.value || null)
                }
                className={inputClass}
              />
            </Field>
            <Field label={t("fieldTags")}>
              <input
                value={state.tags.join(", ")}
                onChange={(e) =>
                  update(
                    "tags",
                    e.target.value
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  )
                }
                className={inputClass}
                placeholder={t("tagsPlaceholder")}
              />
            </Field>
          </Section>

          <Section title={t("sectionCollections")}>
            {payload.collections.length === 0 ? (
              <p className="text-sm text-brand-navy/60">{t("noCollections")}</p>
            ) : (
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {payload.collections.map((collection) => (
                  <label
                    key={collection.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={collectionSet.has(collection.id)}
                      onChange={(e) => {
                        const next = new Set(collectionSet);
                        if (e.target.checked) next.add(collection.id);
                        else next.delete(collection.id);
                        update("collection_ids", Array.from(next));
                      }}
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    <span>{collection.title}</span>
                  </label>
                ))}
              </div>
            )}
          </Section>

          <Section title={t("sectionSeo")}>
            <Field label={t("fieldSeoTitle")}>
              <input
                value={state.seo_title ?? ""}
                onChange={(e) => update("seo_title", e.target.value || null)}
                className={inputClass}
              />
            </Field>
            <Field label={t("fieldSeoDescription")}>
              <textarea
                rows={3}
                value={state.seo_description ?? ""}
                onChange={(e) =>
                  update("seo_description", e.target.value || null)
                }
                className={inputClass}
              />
            </Field>
          </Section>
        </div>
      </div>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-brand-navy">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
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
