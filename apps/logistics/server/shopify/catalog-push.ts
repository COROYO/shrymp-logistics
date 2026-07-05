import "server-only";
import { shopifyGraphQL, ShopifyGraphQLError } from "./client";
import {
  centsToShopifyPrice,
  toCollectionGid,
  toProductGid,
  toVariantGid,
  type ShopifyPushProductResult,
} from "./catalog-queries";
import type { ProductEditorInput } from "@/server/catalog/editor-types";
import {
  canPushVariantsWithOptions,
  defaultSimpleProductSetOptionValues,
  defaultSimpleProductSetOptions,
  filterRealOptions,
  prepareCatalogInputForShopify,
  resolveVariantSku,
  variantOptionValuesForShopify,
} from "@/server/catalog/shopify-catalog-normalize";
import { numericIdFromGid } from "./sync";
import {
  fetchProductGalleryMedia,
  hydrateEditorInputForVariantMedia,
  syncVariantMediaToShopify,
} from "./variant-media-sync";
import {
  applyPushVariantGids,
  indexPushResultVariants,
} from "@/server/catalog/merge-editor-variants";
import { reconcileEditorInputWithShopify } from "@/server/catalog/reconcile-shopify-push.server";

function throwIfUserErrors(
  scope: string,
  errs:
    | ReadonlyArray<{ message: string; field?: ReadonlyArray<string> | null }>
    | null
    | undefined,
): void {
  if (!errs || errs.length === 0) return;
  throw new ShopifyGraphQLError(
    `${scope} userErrors: ${errs.map((e) => e.message).join("; ")}`,
    errs.map((e) => ({
      message: e.message,
      path: e.field ? [...e.field] : undefined,
    })),
  );
}

const PRODUCT_SET_MUTATION = /* GraphQL */ `
  mutation ProductSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
    productSet(input: $input, identifier: $identifier, synchronous: true) {
      product {
        id
        title
        handle
        status
        featuredMedia {
          preview {
            image {
              url(transform: { maxWidth: 400, maxHeight: 400 })
            }
          }
        }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            barcode
            price
            compareAtPrice
            selectedOptions {
              name
              value
            }
            inventoryItem {
              id
              sku
            }
            image {
              url
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_CREATE_MUTATION = /* GraphQL */ `
  mutation ProductCreate($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product {
        id
        title
        handle
        status
        featuredMedia {
          preview {
            image {
              url(transform: { maxWidth: 400, maxHeight: 400 })
            }
          }
        }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            barcode
            price
            compareAtPrice
            selectedOptions {
              name
              value
            }
            inventoryItem {
              id
              sku
            }
            image {
              url
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_CREATE_MEDIA_MUTATION = /* GraphQL */ `
  mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        id
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

type ShopifyVariantNode = {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: string | null;
  compareAtPrice: string | null;
  selectedOptions: Array<{ name: string; value: string }>;
  inventoryItem: { id: string; sku?: string | null } | null;
  image: { url: string } | null;
};

type ShopifyProductNode = {
  id: string;
  title: string;
  handle: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  variants: { nodes: ShopifyVariantNode[] };
};

function buildProductSetInput(
  raw: ProductEditorInput,
  opts: { primaryLocationGid?: string | null; pushInventoryQuantities?: boolean },
) {
  const input = prepareCatalogInputForShopify(raw);
  const realOptions = filterRealOptions(input.options);
  const hasOptions = canPushVariantsWithOptions(input.options, input.variants);

  const productOptions = hasOptions
    ? realOptions.map((o, index) => ({
        name: o.name,
        position: o.position || index + 1,
        values: o.values.map((name) => ({ name })),
      }))
    : defaultSimpleProductSetOptions();

  const optionNames = hasOptions
    ? realOptions.map((o) => o.name)
    : defaultSimpleProductSetOptions().map((o) => o.name);

  const variants = input.variants.map((v, index) => {
    const base: Record<string, unknown> = {
      id: v.shopify_gid ? toVariantGid(v.shopify_gid) : undefined,
      sku: v.sku ?? undefined,
      barcode: v.barcode ?? undefined,
      price: centsToShopifyPrice(v.price_cents),
      compareAtPrice: centsToShopifyPrice(v.compare_at_price_cents),
      position: index + 1,
      inventoryPolicy: v.inventory_policy,
      inventoryItem: {
        tracked: v.inventory_tracked,
        ...(v.unit_cost_cents != null
          ? { cost: (v.unit_cost_cents / 100).toFixed(2) }
          : {}),
      },
    };

    if (
      opts.pushInventoryQuantities &&
      v.inventory_tracked &&
      opts.primaryLocationGid
    ) {
      base.inventoryQuantities = [
        {
          locationId: opts.primaryLocationGid,
          name: "on_hand",
          quantity: v.on_hand,
        },
      ];
    }

    const optionValues = hasOptions
      ? variantOptionValuesForShopify(v, optionNames)!
      : defaultSimpleProductSetOptionValues();

    return { ...base, optionValues };
  });

  const files = input.media
    .filter((m) => !m.id)
    .map((m) => ({
      originalSource: m.url,
      alt: m.alt ?? undefined,
      contentType: "IMAGE" as const,
    }));

  return {
    title: input.title,
    handle: input.handle,
    status: input.status,
    descriptionHtml: input.description_html ?? undefined,
    vendor: input.vendor ?? undefined,
    productType: input.product_type ?? undefined,
    tags: input.tags,
    seo:
      input.seo_title || input.seo_description
        ? {
            title: input.seo_title ?? undefined,
            description: input.seo_description ?? undefined,
          }
        : undefined,
    productOptions,
    variants,
    metafields: input.metafields
      .filter((m) => m.key.trim().length > 0 && m.value.trim().length > 0)
      .map((m) => ({
        namespace: m.namespace,
        key: m.key,
        type: m.type,
        value: m.value,
      })),
    collections: input.collection_ids.map(toCollectionGid),
    files: files.length > 0 ? files : undefined,
  };
}

function buildProductCreateInput(
  input: ProductEditorInput,
  opts: { primaryLocationGid?: string | null; pushInventoryQuantities?: boolean },
) {
  const setInput = buildProductSetInput(input, opts);
  return {
    title: setInput.title,
    handle: setInput.handle,
    status: setInput.status,
    descriptionHtml: setInput.descriptionHtml,
    vendor: setInput.vendor,
    productType: setInput.productType,
    tags: setInput.tags,
    seo: setInput.seo,
    productOptions: setInput.productOptions,
    variants: setInput.variants.map(({ id: _id, ...rest }) => rest),
    metafields: setInput.metafields,
    collections: setInput.collections,
    media: input.media.map((m) => ({
      originalSource: m.url,
      alt: m.alt ?? undefined,
      mediaContentType: "IMAGE" as const,
    })),
  };
}

function mapPushResult(product: ShopifyProductNode): ShopifyPushProductResult {
  const rawOptionNames =
    product.variants.nodes[0]?.selectedOptions.map((o) => o.name) ?? [];
  const optionNames = rawOptionNames.filter(
    (name) => name !== "Title" && name !== "Titel",
  );
  return {
    productGid: product.id,
    productId: numericIdFromGid(product.id),
    handle: product.handle,
    imageUrl: product.featuredMedia?.preview?.image?.url ?? null,
    variants: product.variants.nodes.map((v, index) => {
      const byName = new Map(v.selectedOptions.map((o) => [o.name, o.value]));
      return {
        variantId: numericIdFromGid(v.id),
        shopifyGid: v.id,
        inventoryItemGid: v.inventoryItem?.id ?? null,
        title: v.title,
        sku: resolveVariantSku(v),
        barcode: v.barcode,
        priceCents: v.price ? Math.round(parseFloat(v.price) * 100) : null,
        compareAtPriceCents: v.compareAtPrice
          ? Math.round(parseFloat(v.compareAtPrice) * 100)
          : null,
        imageUrl: v.image?.url ?? null,
        option1: optionNames[0] ? (byName.get(optionNames[0]) ?? null) : null,
        option2: optionNames[1] ? (byName.get(optionNames[1]) ?? null) : null,
        option3: optionNames[2] ? (byName.get(optionNames[2]) ?? null) : null,
        position: index,
      };
    }),
  };
}

async function runVariantMediaSync(
  input: ProductEditorInput,
  opts: { shopId: string; productGid: string; pushResult: ShopifyPushProductResult },
): Promise<void> {
  const shopifyMedia = await fetchProductGalleryMedia(opts.productGid, opts.shopId);
  const withGids = applyPushVariantGids(
    input,
    indexPushResultVariants(opts.pushResult.variants),
  );
  const hydrated = hydrateEditorInputForVariantMedia(withGids, shopifyMedia);
  await syncVariantMediaToShopify(hydrated, {
    shopId: opts.shopId,
    productGid: opts.productGid,
  });
}

export async function pushProductToShopify(
  input: ProductEditorInput,
  opts: {
    shopId: string;
    productGid?: string | null;
    primaryLocationGid?: string | null;
    pushInventoryQuantities?: boolean;
  },
): Promise<ShopifyPushProductResult> {
  const pushOpts = {
    primaryLocationGid: opts.primaryLocationGid,
    pushInventoryQuantities: opts.pushInventoryQuantities ?? false,
  };

  if (opts.productGid) {
    const pushInput = await reconcileEditorInputWithShopify(
      input,
      opts.productGid,
      opts.shopId,
    );
    const data = await shopifyGraphQL<{
      productSet: {
        product: ShopifyProductNode | null;
        userErrors: Array<{ message: string; field?: string[] | null }>;
      };
    }>(
      PRODUCT_SET_MUTATION,
      {
        input: buildProductSetInput(pushInput, pushOpts),
        identifier: { id: toProductGid(opts.productGid) },
      },
      { shopId: opts.shopId },
    );
    throwIfUserErrors("productSet", data.productSet.userErrors);
    const product = data.productSet.product;
    if (!product) throw new Error("productSet: no product returned");
    const result = mapPushResult(product);
    await runVariantMediaSync(pushInput, {
      shopId: opts.shopId,
      productGid: result.productGid,
      pushResult: result,
    });
    return result;
  }

  const data = await shopifyGraphQL<{
    productCreate: {
      product: ShopifyProductNode | null;
      userErrors: Array<{ message: string; field?: string[] | null }>;
    };
  }>(
    PRODUCT_CREATE_MUTATION,
    { product: buildProductCreateInput(input, pushOpts) },
    { shopId: opts.shopId },
  );
  throwIfUserErrors("productCreate", data.productCreate.userErrors);
  const product = data.productCreate.product;
  if (!product) throw new Error("productCreate: no product returned");

  const newMedia = input.media.filter((m) => !m.id);
  if (newMedia.length > 0) {
    const mediaData = await shopifyGraphQL<{
      productCreateMedia: {
        mediaUserErrors: Array<{ message: string; field?: string[] | null }>;
      };
    }>(
      PRODUCT_CREATE_MEDIA_MUTATION,
      {
        productId: product.id,
        media: newMedia.map((m) => ({
          originalSource: m.url,
          alt: m.alt ?? undefined,
          mediaContentType: "IMAGE",
        })),
      },
      { shopId: opts.shopId },
    );
    throwIfUserErrors(
      "productCreateMedia",
      mediaData.productCreateMedia.mediaUserErrors,
    );
  }

  const result = mapPushResult(product);
  await runVariantMediaSync(input, {
    shopId: opts.shopId,
    productGid: result.productGid,
    pushResult: result,
  });
  return result;
}
