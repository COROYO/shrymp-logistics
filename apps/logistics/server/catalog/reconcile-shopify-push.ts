import type {
  ProductEditorFormInput,
  ProductEditorInput,
  ProductEditorVariant,
} from "@/server/catalog/editor-types";
import {
  filterRealOptions,
  hasRealProductOptions,
  prepareCatalogInputForShopify,
} from "@/server/catalog/shopify-catalog-normalize";
import { toVariantGid } from "@/server/shopify/catalog-queries";
import { buildVariantsFromOptions, variantOptionKey } from "./variant-matrix";

function indexByOptionKey(
  variants: ProductEditorVariant[],
): Map<string, ProductEditorVariant> {
  const map = new Map<string, ProductEditorVariant>();
  for (const variant of variants) {
    map.set(variantOptionKey(variant), variant);
  }
  return map;
}

function validShopifyGids(variants: ProductEditorVariant[]): Set<string> {
  return new Set(
    variants
      .filter((v) => v.shopify_gid && !v.shopify_gid.startsWith("local://"))
      .map((v) => toVariantGid(v.shopify_gid!)),
  );
}

function stripInvalidShopifyGid(
  variant: ProductEditorVariant,
  validGids: Set<string>,
): ProductEditorVariant {
  if (!variant.shopify_gid || variant.shopify_gid.startsWith("local://")) {
    return variant;
  }
  if (validGids.has(toVariantGid(variant.shopify_gid))) return variant;
  const { shopify_gid: _gid, ...rest } = variant;
  return rest;
}

function linkVariantToShopify(
  editor: ProductEditorVariant,
  remoteByKey: Map<string, ProductEditorVariant>,
  validGids: Set<string>,
): ProductEditorVariant {
  const remote = remoteByKey.get(variantOptionKey(editor));
  let merged: ProductEditorVariant = {
    ...editor,
    id: editor.id ?? remote?.id,
    shopify_gid: remote?.shopify_gid ?? editor.shopify_gid,
  };
  merged = stripInvalidShopifyGid(merged, validGids);
  return merged;
}

/**
 * Load path: keep the editor option matrix, attach Shopify GIDs by option combo.
 */
export function mergeShopifyLinksOntoEditorVariants(
  input: ProductEditorFormInput,
  remote: ProductEditorFormInput,
): ProductEditorFormInput {
  const options = hasRealProductOptions(input.options)
    ? filterRealOptions(input.options)
    : hasRealProductOptions(remote.options)
      ? filterRealOptions(remote.options)
      : [];

  const variantsBase =
    options.length > 0
      ? buildVariantsFromOptions(options, input.variants)
      : input.variants.length > 0
        ? input.variants
        : remote.variants;

  const remoteByKey = indexByOptionKey(remote.variants);
  const validGids = validShopifyGids(remote.variants);

  return {
    ...input,
    options,
    variants: variantsBase.map((v) => linkVariantToShopify(v, remoteByKey, validGids)),
  };
}

/**
 * Push path: send the full editor matrix; reuse Shopify IDs only when the option combo still exists.
 */
export function prepareEditorInputForShopifyPush(
  input: ProductEditorInput,
  remote: ProductEditorFormInput,
): ProductEditorInput {
  const prepared = prepareCatalogInputForShopify(input);
  const remoteByKey = indexByOptionKey(remote.variants);
  const validGids = validShopifyGids(remote.variants);

  const variants = prepared.variants.map((variant) => {
    const linked = linkVariantToShopify(variant, remoteByKey, validGids);
    if (linked.shopify_gid && validGids.has(toVariantGid(linked.shopify_gid))) {
      return linked;
    }
    const { shopify_gid: _gid, ...create } = linked;
    return create;
  });

  return { ...prepared, variants };
}

/** @deprecated Use mergeShopifyLinksOntoEditorVariants or prepareEditorInputForShopifyPush. */
export function mergeEditorInputWithShopifyVariants(
  input: ProductEditorInput | ProductEditorFormInput,
  remote: ProductEditorFormInput,
): ProductEditorFormInput {
  return mergeShopifyLinksOntoEditorVariants(
    input as ProductEditorFormInput,
    remote,
  );
}

export function mergeEditorInputWithShopifyVariantsForPush(
  input: ProductEditorInput,
  remote: ProductEditorFormInput,
): ProductEditorInput {
  return prepareEditorInputForShopifyPush(input, remote);
}
