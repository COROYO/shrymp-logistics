import type {
  ProductEditorOption,
  ProductEditorVariant,
} from "./editor-types";

const MAX_OPTIONS = 3;

/** Cartesian product of option value lists. */
export function cartesian<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  return arrays.reduce<T[][]>(
    (acc, curr) => acc.flatMap((prefix) => curr.map((v) => [...prefix, v])),
    [[]],
  );
}

function variantKey(
  option1: string | null,
  option2: string | null,
  option3: string | null,
): string {
  return variantOptionKey({ option1, option2, option3 });
}

/** Stable key for matching app variants ↔ Shopify variants (option combination). */
export function variantOptionKey(v: {
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
}): string {
  return [v.option1 ?? "", v.option2 ?? "", v.option3 ?? ""].join("\0");
}

function normalizeOptions(
  options: ProductEditorOption[],
): ProductEditorOption[] {
  return options
    .slice(0, MAX_OPTIONS)
    .map((o, index) => ({
      name: o.name.trim(),
      position: o.position || index + 1,
      values: [...new Set(o.values.map((v) => v.trim()).filter(Boolean))],
    }))
    .filter((o) => o.name && o.values.length > 0);
}

/**
 * Build variant rows from product options (Shopify-style matrix).
 * Preserves SKU/price/barcode/ids when the option combination matches.
 */
export function buildVariantsFromOptions(
  options: ProductEditorOption[],
  existing: ProductEditorVariant[],
): ProductEditorVariant[] {
  const active = normalizeOptions(options);
  if (active.length === 0) {
    if (existing.length > 0) {
      return existing.map((v) => ({
        ...v,
        option1: null,
        option2: null,
        option3: null,
      }));
    }
    return [
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
        position: 0,
        on_hand: 0,
        inventory_tracked: true,
        inventory_policy: "DENY",
        unit_cost_cents: null,
      },
    ];
  }

  const byKey = new Map<string, ProductEditorVariant>();
  for (const v of existing) {
    byKey.set(variantKey(v.option1, v.option2, v.option3), v);
  }

  const combos = cartesian(active.map((o) => o.values));
  return combos.map((combo, index) => {
    const option1 = combo[0] ?? null;
    const option2 = combo[1] ?? null;
    const option3 = combo[2] ?? null;
    const title = combo.join(" / ");
    const prior =
      byKey.get(variantKey(option1, option2, option3)) ??
      existing.find((v) => v.title === title);

    const row: ProductEditorVariant = {
      title,
      sku: prior?.sku ?? null,
      barcode: prior?.barcode ?? null,
      price_cents: prior?.price_cents ?? null,
      compare_at_price_cents: prior?.compare_at_price_cents ?? null,
      image_url: prior?.image_url ?? null,
      image_media_id: prior?.image_media_id ?? null,
      option1,
      option2,
      option3,
      position: index,
      on_hand: prior?.on_hand ?? 0,
      inventory_tracked: prior?.inventory_tracked ?? true,
      inventory_policy: prior?.inventory_policy ?? "DENY",
      unit_cost_cents: prior?.unit_cost_cents ?? null,
    };
    if (prior?.id) row.id = prior.id;
    if (prior?.shopify_gid) row.shopify_gid = prior.shopify_gid;
    return row;
  });
}

export { MAX_OPTIONS as MAX_PRODUCT_OPTIONS };
