import type {
  ProductEditorFormInput,
  ProductEditorInput,
  ProductEditorOption,
  ProductEditorVariant,
} from "./editor-types";
import { buildVariantsFromOptions } from "./variant-matrix";

export const SHOPIFY_DEFAULT_OPTION_NAME = "Title";
export const SHOPIFY_DEFAULT_VARIANT_TITLE = "Default Title";

export function isPlaceholderShopifyOption(option: {
  name: string;
  values: string[];
}): boolean {
  const name = option.name.trim();
  if (name !== SHOPIFY_DEFAULT_OPTION_NAME && name !== "Titel") return false;
  const values = option.values.map((v) => v.trim()).filter(Boolean);
  return (
    values.length === 1 &&
    (values[0] === SHOPIFY_DEFAULT_VARIANT_TITLE ||
      values[0] === "Standardtitel")
  );
}

export function filterRealOptions(
  options: ProductEditorOption[],
): ProductEditorOption[] {
  return options
    .filter(
      (o) =>
        !isPlaceholderShopifyOption(o) &&
        o.name.trim().length > 0 &&
        o.values.some((v) => v.trim().length > 0),
    )
    .map((o, index) => ({
      ...o,
      name: o.name.trim(),
      position: index + 1,
      values: [...new Set(o.values.map((v) => v.trim()).filter(Boolean))],
    }));
}

export function hasRealProductOptions(options: ProductEditorOption[]): boolean {
  return filterRealOptions(options).length > 0;
}

export function isPlaceholderVariantTitle(title: string): boolean {
  const t = title.trim();
  return t === "" || t === SHOPIFY_DEFAULT_VARIANT_TITLE || t === "Standardtitel";
}

function emptyVariant(): ProductEditorVariant {
  return {
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
    position: 0,
    on_hand: 0,
    inventory_tracked: true,
    inventory_policy: "DENY",
    unit_cost_cents: null,
  };
}

/** Strip Shopify's implicit Title/Default Title before showing in the editor. */
export function normalizeProductEditorInput(
  input: ProductEditorFormInput,
): ProductEditorFormInput {
  const options = filterRealOptions(input.options);
  if (!hasRealProductOptions(input.options)) {
    if (input.variants.length <= 1) {
      const variant = input.variants[0] ?? emptyVariant();
      return {
        ...input,
        options: [],
        variants: [
          {
            ...variant,
            title: isPlaceholderVariantTitle(variant.title) ? "" : variant.title,
            option1: null,
            option2: null,
            option3: null,
            position: 0,
          },
        ],
      };
    }
    return {
      ...input,
      options: [],
      variants: input.variants.map((v, index) => ({
        ...v,
        option1: null,
        option2: null,
        option3: null,
        position: v.position ?? index,
      })),
    };
  }

  return {
    ...input,
    options,
    variants: buildVariantsFromOptions(options, input.variants),
  };
}

/** Normalize + ensure Shopify-safe shape before productSet/productCreate. */
export function prepareCatalogInputForShopify(
  input: ProductEditorInput,
): ProductEditorInput {
  const options = filterRealOptions(input.options);

  if (options.length === 0) {
    const base = input.variants[0] ?? emptyVariant();
    const clearedVariants =
      input.variants.length > 0
        ? input.variants.map((v) => ({
            ...v,
            option1: null,
            option2: null,
            option3: null,
          }))
        : [
            {
              ...base,
              title:
                base.title.trim() ||
                input.title.trim() ||
                SHOPIFY_DEFAULT_VARIANT_TITLE,
              option1: null,
              option2: null,
              option3: null,
              position: 0,
            },
          ];
    return {
      ...input,
      options: [],
      variants: clearedVariants,
    };
  }

  return {
    ...input,
    options,
    variants: buildVariantsFromOptions(options, input.variants),
  };
}

export function resolveVariantSku(variant: {
  sku?: string | null;
  inventoryItem?: { sku?: string | null } | null;
}): string | null {
  const direct = variant.sku?.trim();
  if (direct) return direct;
  const fromItem = variant.inventoryItem?.sku?.trim();
  return fromItem || null;
}

export type ShopifyVariantOptionValueInput = {
  optionName: string;
  name: string;
};

export type ShopifyProductSetOptionInput = {
  name: string;
  position: number;
  values: { name: string }[];
};

/** Shopify productSet requires non-null optionValues on every variant. */
export function defaultSimpleProductSetOptionValues(): ShopifyVariantOptionValueInput[] {
  return [
    {
      optionName: SHOPIFY_DEFAULT_OPTION_NAME,
      name: SHOPIFY_DEFAULT_VARIANT_TITLE,
    },
  ];
}

/** Hidden Title/Default Title pair for simple products in productSet only. */
export function defaultSimpleProductSetOptions(): ShopifyProductSetOptionInput[] {
  return [
    {
      name: SHOPIFY_DEFAULT_OPTION_NAME,
      position: 1,
      values: [{ name: SHOPIFY_DEFAULT_VARIANT_TITLE }],
    },
  ];
}

/** Build productSet optionValues only when every option slot is filled. */
export function variantOptionValuesForShopify(
  variant: ProductEditorVariant,
  optionNames: readonly string[],
): ShopifyVariantOptionValueInput[] | undefined {
  if (optionNames.length === 0) return undefined;
  const out: ShopifyVariantOptionValueInput[] = [];
  for (let i = 0; i < optionNames.length; i++) {
    const value = [variant.option1, variant.option2, variant.option3][i]?.trim();
    if (!value) return undefined;
    out.push({ optionName: optionNames[i]!, name: value });
  }
  return out;
}

/** True when real options exist and every variant row has matching option values. */
export function canPushVariantsWithOptions(
  options: ProductEditorOption[],
  variants: ProductEditorVariant[],
): boolean {
  const real = filterRealOptions(options);
  if (real.length === 0) return false;
  const names = real.map((o) => o.name);
  return variants.every(
    (v) => variantOptionValuesForShopify(v, names) !== undefined,
  );
}
