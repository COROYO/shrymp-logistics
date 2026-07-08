import "server-only";
import { shopifyGraphQL, ShopifyGraphQLError } from "./client";
import {
  attachShopifyMediaIds,
  resolveShopifyMediaIdForVariant,
  syncVariantImagesWithGallery,
  type GalleryMediaRef,
} from "@/lib/variant-image";
import type { ProductEditorInput, ProductEditorVariant } from "@/server/catalog/editor-types";
import { variantOptionKey } from "@/server/catalog/variant-matrix";
import { toProductGid, toVariantGid } from "./catalog-queries";

const PRODUCT_VARIANT_MEDIA_QUERY = /* GraphQL */ `
  query ProductVariantMedia($id: ID!) {
    product(id: $id) {
      id
      media(first: 50) {
        nodes {
          ... on MediaImage {
            id
            image {
              url
            }
          }
        }
      }
      variants(first: 100) {
        nodes {
          id
          selectedOptions {
            name
            value
          }
          media(first: 10) {
            nodes {
              id
            }
          }
        }
      }
    }
  }
`;

const VARIANT_APPEND_MEDIA = /* GraphQL */ `
  mutation ProductVariantAppendMedia(
    $productId: ID!
    $variantMedia: [ProductVariantAppendMediaInput!]!
  ) {
    productVariantAppendMedia(
      productId: $productId,
      variantMedia: $variantMedia
    ) {
      userErrors {
        field
        message
      }
    }
  }
`;

const VARIANT_DETACH_MEDIA = /* GraphQL */ `
  mutation ProductVariantDetachMedia(
    $productId: ID!
    $variantMedia: [ProductVariantDetachMediaInput!]!
  ) {
    productVariantDetachMedia(
      productId: $productId,
      variantMedia: $variantMedia
    ) {
      userErrors {
        field
        message
      }
    }
  }
`;

function throwMediaUserErrors(
  scope: string,
  errs: ReadonlyArray<{ message: string }> | null | undefined,
): void {
  if (!errs?.length) return;
  throw new ShopifyGraphQLError(
    `${scope}: ${errs.map((e) => e.message).join("; ")}`,
    errs.map((e) => ({ message: e.message })),
  );
}

function remoteVariantOptionKey(
  selectedOptions: Array<{ name: string; value: string }>,
): string {
  return variantOptionKey({
    option1: selectedOptions[0]?.value ?? null,
    option2: selectedOptions[1]?.value ?? null,
    option3: selectedOptions[2]?.value ?? null,
  });
}

function indexEditorVariants(variants: ProductEditorVariant[]) {
  const byGid = new Map<string, ProductEditorVariant>();
  const byOption = new Map<string, ProductEditorVariant>();
  for (const variant of variants) {
    byOption.set(variantOptionKey(variant), variant);
    if (variant.shopify_gid && !variant.shopify_gid.startsWith("local://")) {
      byGid.set(toVariantGid(variant.shopify_gid), variant);
    }
  }
  return { byGid, byOption };
}

function findEditorVariant(
  remote: {
    id: string;
    selectedOptions: Array<{ name: string; value: string }>;
  },
  index: ReturnType<typeof indexEditorVariants>,
): ProductEditorVariant | undefined {
  return (
    index.byGid.get(remote.id) ??
    index.byOption.get(remoteVariantOptionKey(remote.selectedOptions))
  );
}

export async function fetchProductGalleryMedia(
  productGid: string,
  shopId: string,
): Promise<GalleryMediaRef[]> {
  const productId = toProductGid(productGid);
  const data = await shopifyGraphQL<{
    product: {
      media: {
        nodes: Array<{ id: string; image: { url: string } | null }>;
      };
    } | null;
  }>(PRODUCT_VARIANT_MEDIA_QUERY, { id: productId }, { shopId });

  return (data.product?.media.nodes ?? [])
    .filter((n) => n.image?.url)
    .map((n) => ({ id: n.id, url: n.image!.url }));
}

/** Resolve staged-upload URLs to Shopify media IDs before variant append. */
export function hydrateEditorInputForVariantMedia(
  input: ProductEditorInput,
  shopifyMedia: GalleryMediaRef[],
): ProductEditorInput {
  const media = attachShopifyMediaIds(
    input.media.map((m) => ({ id: m.id, url: m.url })),
    shopifyMedia,
  ).map((m, index) => ({
    id: m.id,
    url: m.url,
    alt: input.media[index]?.alt ?? null,
    position: input.media[index]?.position ?? index,
  }));

  const variants = input.variants.map((v) => ({ ...v }));
  syncVariantImagesWithGallery(variants, media);

  return { ...input, media, variants };
}

/** Link product gallery images to variants via productVariantAppendMedia. */
export async function syncVariantMediaToShopify(
  input: ProductEditorInput,
  opts: { shopId: string; productGid: string },
): Promise<void> {
  const productId = toProductGid(opts.productGid);
  const data = await shopifyGraphQL<{
    product: {
      media: {
        nodes: Array<{ id: string; image: { url: string } | null }>;
      };
      variants: {
        nodes: Array<{
          id: string;
          selectedOptions: Array<{ name: string; value: string }>;
          media: { nodes: Array<{ id: string }> };
        }>;
      };
    } | null;
  }>(PRODUCT_VARIANT_MEDIA_QUERY, { id: productId }, { shopId: opts.shopId });

  const product = data.product;
  if (!product) throw new Error("syncVariantMedia: product not found");

  const shopifyMedia: GalleryMediaRef[] = product.media.nodes
    .filter((n) => n.image?.url)
    .map((n) => ({ id: n.id, url: n.image!.url }));

  const gallery: GalleryMediaRef[] = input.media.map((m) => ({
    id: m.id,
    url: m.url,
  }));

  const editorIndex = indexEditorVariants(input.variants);

  const toAppend: Array<{ variantId: string; mediaIds: string[] }> = [];
  const toDetach: Array<{ variantId: string; mediaIds: string[] }> = [];

  for (const remote of product.variants.nodes) {
    const editor = findEditorVariant(remote, editorIndex);
    if (!editor) continue;

    const desiredMediaId = resolveShopifyMediaIdForVariant(
      editor,
      gallery,
      shopifyMedia,
    );
    const currentMediaIds = remote.media.nodes.map((n) => n.id);

    if (!desiredMediaId) {
      if (currentMediaIds.length > 0) {
        toDetach.push({ variantId: remote.id, mediaIds: currentMediaIds });
      }
      continue;
    }

    if (currentMediaIds.length === 1 && currentMediaIds[0] === desiredMediaId) {
      continue;
    }

    if (currentMediaIds.length > 0) {
      toDetach.push({ variantId: remote.id, mediaIds: currentMediaIds });
    }
    toAppend.push({ variantId: remote.id, mediaIds: [desiredMediaId] });
  }

  if (toDetach.length > 0) {
    const detachData = await shopifyGraphQL<{
      productVariantDetachMedia: {
        userErrors: Array<{ message: string }>;
      };
    }>(
      VARIANT_DETACH_MEDIA,
      {
        productId,
        variantMedia: toDetach.map((row) => ({
          variantId: row.variantId,
          mediaIds: row.mediaIds,
        })),
      },
      { shopId: opts.shopId },
    );
    throwMediaUserErrors(
      "productVariantDetachMedia",
      detachData.productVariantDetachMedia.userErrors,
    );
  }

  if (toAppend.length > 0) {
    const appendData = await shopifyGraphQL<{
      productVariantAppendMedia: {
        userErrors: Array<{ message: string }>;
      };
    }>(
      VARIANT_APPEND_MEDIA,
      {
        productId,
        variantMedia: toAppend.map((row) => ({
          variantId: row.variantId,
          mediaIds: row.mediaIds,
        })),
      },
      { shopId: opts.shopId },
    );
    throwMediaUserErrors(
      "productVariantAppendMedia",
      appendData.productVariantAppendMedia.userErrors,
    );
  }
}
