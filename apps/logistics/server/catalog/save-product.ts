import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type Product,
  type Variant,
} from "@/server/firestore/schema";
import { normalizeShopId } from "@/server/tenant/id";
import { isAppInventorySource, loadLagerConfig } from "@/server/lager/config";
import { getShop } from "@/server/tenant/shop";
import { getDefaultLocationId } from "@/server/locations/stock";
import { adjustVariantStock } from "@/server/inventory/variant-inventory";
import {
  fetchShopifyProductDetail,
  listShopifyCollections,
  type ProductDetailInput,
} from "@/server/shopify/catalog-queries";
import {
  ProductEditorInputSchema,
  type ProductEditorFormInput,
  type ProductEditorPayload,
} from "./editor-types";
import { pushProductToShopify } from "@/server/shopify/catalog-push";
import { normalizeProductEditorInput } from "./shopify-catalog-normalize";
import { mergeEditorInputWithShopify } from "./merge-editor-input";
import { mergeEditorVariantsWithDb, mapPushVariantsToFirestore } from "./merge-editor-variants";
import { mergeShopifyLinksOntoEditorVariants } from "./reconcile-shopify-push";
import { loadProductEditorVariantInventory } from "./product-editor-inventory";
import {
  fetchAllProductMetafields,
  fetchProductMetafieldDefinitions,
  mergeMetafieldsWithDefinitions,
  mergeProductMetafieldValues,
} from "@/server/shopify/catalog-metafields";
import { resolveVariantImageMediaId } from "@/lib/variant-image";
import { log } from "@/lib/logger";

export class CatalogSaveError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "wrong_tenant"
      | "invalid"
      | "shopify_error",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "CatalogSaveError";
  }
}

function slugifyHandle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function loadProductEditorPayload(
  shopId: string,
  productId?: string,
): Promise<ProductEditorPayload> {
  const db = adminDb();
  const cfg = await loadLagerConfig(shopId);
  let collections: Awaited<ReturnType<typeof listShopifyCollections>> = [];
  try {
    collections = await listShopifyCollections(shopId);
  } catch (e) {
    log.warn("catalog_collections_load_failed", { shopId, error: String(e) });
  }

  if (!productId) {
    return {
      productId: "",
      shopifyGid: null,
      isNew: true,
      defaultSyncToShopify: cfg.catalog_sync_to_shopify,
      collections,
      batchesEnabled: cfg.batches_enabled,
      variantInventory: [],
      inventoryLocations: [],
      defaultLocationId: null,
      input: {
        title: "",
        handle: "",
        status: "DRAFT",
        description_html: null,
        vendor: null,
        product_type: null,
        tags: [],
        seo_title: null,
        seo_description: null,
        collection_ids: [],
        media: [],
        options: [],
        metafields: [],
        variants: [
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
        ],
      },
    };
  }

  const ref = db.collection(Collections.Products).doc(productId);
  const snap = await ref.get();
  if (!snap.exists) throw new CatalogSaveError("not_found");
  const product = snap.data() as Product;
  if (normalizeShopId(product.shop_id) !== normalizeShopId(shopId)) {
    throw new CatalogSaveError("wrong_tenant");
  }

  const variantSnap = await db
    .collection(Collections.Variants)
    .where("product_id", "==", productId)
    .get();
  const variants = variantSnap.docs
    .map((d) => ({ ...(d.data() as Variant), id: d.id }))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const inventory = await loadProductEditorVariantInventory(
    shopId,
    variants,
    cfg,
  );
  const onHandByVariantId = new Map(
    inventory.rows.map((row) => [row.id, row.onHand]),
  );

  const baseInput: ProductEditorFormInput = {
    title: product.title,
    handle: product.handle,
    status: product.status,
    description_html: product.description_html ?? null,
    vendor: product.vendor ?? null,
    product_type: product.product_type ?? null,
    tags: product.tags ?? [],
    seo_title: product.seo_title ?? null,
    seo_description: product.seo_description ?? null,
    collection_ids: product.collection_ids ?? [],
    media: (product.media ?? []).map((m) => ({
      id: m.id,
      url: m.url,
      alt: m.alt,
      position: m.position,
    })),
    options: product.options ?? [],
    metafields: product.metafields ?? [],
    variants: variants.map((v) => {
      const gallery = (product.media ?? []).map((m) => ({
        id: m.id,
        url: m.url,
      }));
      return {
      id: v.id,
      shopify_gid: v.shopify_gid,
      title: v.title,
      sku: v.sku,
      barcode: v.barcode,
      price_cents: v.price_cents,
      compare_at_price_cents: v.compare_at_price_cents ?? null,
      image_url: v.image_url,
      image_media_id: resolveVariantImageMediaId(v.image_url, gallery),
      option1: v.option1 ?? null,
      option2: v.option2 ?? null,
      option3: v.option3 ?? null,
      position: v.position ?? 0,
      on_hand: onHandByVariantId.get(v.id) ?? v.on_hand_total ?? 0,
      inventory_tracked: v.inventory_tracked ?? true,
      inventory_policy: v.inventory_policy ?? "DENY",
      unit_cost_cents: v.unit_cost_cents ?? null,
    };
    }),
  };

  let input: ProductEditorFormInput = baseInput;
  if (product.shopify_gid && !product.shopify_gid.startsWith("local://")) {
    const productGid = product.shopify_gid;
    let shopify: ProductEditorFormInput | null = null;
    let liveMetafields: Awaited<ReturnType<typeof fetchAllProductMetafields>> =
      [];
    let definitions: Awaited<
      ReturnType<typeof fetchProductMetafieldDefinitions>
    > = [];

    try {
      shopify = await fetchShopifyProductDetail(productGid, shopId);
    } catch (e) {
      log.warn("catalog_hydrate_failed", { productId, error: String(e) });
    }

    try {
      liveMetafields = await fetchAllProductMetafields(productGid, shopId);
    } catch (e) {
      log.warn("catalog_metafields_failed", { productId, error: String(e) });
    }

    try {
      definitions = await fetchProductMetafieldDefinitions(shopId, productGid);
    } catch (e) {
      log.warn("catalog_metafield_definitions_failed", {
        productId,
        error: String(e),
      });
    }

    if (shopify) {
      input = mergeEditorInputWithShopify(baseInput, shopify);
      input = mergeShopifyLinksOntoEditorVariants(input, shopify);
    }

    input.metafields = mergeProductMetafieldValues(
      input.metafields,
      liveMetafields.length > 0 ? liveMetafields : (shopify?.metafields ?? []),
    );
    input.metafields = mergeMetafieldsWithDefinitions(
      input.metafields,
      definitions,
    );
  }

  return {
    productId,
    shopifyGid: product.shopify_gid,
    isNew: false,
    defaultSyncToShopify: cfg.catalog_sync_to_shopify,
    collections,
    batchesEnabled: inventory.batchesEnabled,
    variantInventory: inventory.rows,
    inventoryLocations: inventory.locations,
    defaultLocationId: inventory.defaultLocationId,
    input: normalizeProductEditorInput(input),
  };
}

export async function saveProductEditor(input: {
  shopId: string;
  raw: unknown;
  userId?: string;
}): Promise<{ productId: string; syncedToShopify: boolean }> {
  const parsed = ProductEditorInputSchema.safeParse(input.raw);
  if (!parsed.success) {
    throw new CatalogSaveError("invalid", parsed.error.message);
  }
  const data = parsed.data;
  const db = adminDb();
  const cfg = await loadLagerConfig(input.shopId);
  const shouldSync = data.sync_to_shopify && cfg.catalog_sync_to_shopify;
  const appInventorySource = await isAppInventorySource(input.shopId);
  const shop = await getShop(input.shopId);
  const primaryLocationGid = shop?.location_gid ?? null;

  const handle = data.handle.trim() || slugifyHandle(data.title);
  let productId = data.product_id?.trim() ?? "";
  let editorInput = { ...data, handle };

  if (productId) {
    const variantSnap = await db
      .collection(Collections.Variants)
      .where("product_id", "==", productId)
      .get();
    const dbVariants = variantSnap.docs
      .map((d) => d.data() as Variant)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    editorInput = {
      ...editorInput,
      variants: mergeEditorVariantsWithDb(dbVariants, editorInput.variants),
    };
  }

  let shopifyGid: string | null = null;
  let pushResult: Awaited<ReturnType<typeof pushProductToShopify>> | null = null;

  const priorVariants = productId
    ? (
        await db
          .collection(Collections.Variants)
          .where("product_id", "==", productId)
          .get()
      ).docs.map((d) => d.data() as Variant)
    : [];

  if (shouldSync) {
    const existing = productId
      ? await db.collection(Collections.Products).doc(productId).get()
      : null;
    shopifyGid =
      existing?.exists && existing.data()
        ? ((existing.data() as Product).shopify_gid ?? null)
        : null;
    pushResult = await pushProductToShopify(editorInput, {
      shopId: input.shopId,
      productGid: shopifyGid,
      primaryLocationGid,
      pushInventoryQuantities: !appInventorySource,
    });
    productId = pushResult.productId;
    shopifyGid = pushResult.productGid;
  } else if (!productId) {
    productId = db.collection(Collections.Products).doc().id;
  }

  const productRef = db.collection(Collections.Products).doc(productId);
  const existingSnap = await productRef.get();
  if (existingSnap.exists) {
    const existing = existingSnap.data() as Product;
    if (normalizeShopId(existing.shop_id) !== normalizeShopId(input.shopId)) {
      throw new CatalogSaveError("wrong_tenant");
    }
    shopifyGid = shopifyGid ?? existing.shopify_gid;
  }

  const imageUrl =
    pushResult?.imageUrl ??
    editorInput.media[0]?.url ??
    (existingSnap.exists ? ((existingSnap.data() as Product).image_url ?? null) : null);

  const productDoc: Omit<Product, "synced_at"> & {
    synced_at: FirebaseFirestore.FieldValue;
  } = {
    id: productId,
    shop_id: normalizeShopId(input.shopId),
    shopify_gid: shopifyGid ?? `local://${productId}`,
    title: editorInput.title.trim(),
    handle,
    status: editorInput.status,
    image_url: imageUrl,
    description_html: editorInput.description_html,
    vendor: editorInput.vendor,
    product_type: editorInput.product_type,
    tags: editorInput.tags,
    seo_title: editorInput.seo_title,
    seo_description: editorInput.seo_description,
    collection_ids: editorInput.collection_ids,
    media: editorInput.media.map((m, index) => ({
      id: m.id,
      url: m.url,
      alt: m.alt,
      position: m.position ?? index,
    })),
    options: editorInput.options,
    metafields: editorInput.metafields
      .filter((m) => m.key.trim().length > 0 && m.namespace.trim().length > 0)
      .map(({ namespace, key, type, value }) => ({
        namespace,
        key,
        type,
        value,
      })),
    is_bundle: existingSnap.exists
      ? ((existingSnap.data() as Product).is_bundle ?? false)
      : false,
    synced_at: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.set(productRef, productDoc, { merge: true });

  const variantRows = pushResult
    ? mapPushVariantsToFirestore(editorInput.variants, pushResult.variants)
    : editorInput.variants.map((v, index) => ({
        variantId: v.id ?? db.collection(Collections.Variants).doc().id,
        shopifyGid: v.shopify_gid ?? `local://${v.id ?? index}`,
        inventoryItemGid: null,
        title: v.title,
        sku: v.sku,
        barcode: v.barcode,
        priceCents: v.price_cents,
        compareAtPriceCents: v.compare_at_price_cents,
        imageUrl: v.image_url,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
        position: v.position ?? index,
        onHand: v.on_hand,
        inventoryTracked: v.inventory_tracked,
        inventoryPolicy: v.inventory_policy,
        unitCostCents: v.unit_cost_cents,
      }));

  const editorVariantByKey = new Map(
    editorInput.variants.map((v, index) => [
      v.id ?? v.shopify_gid ?? String(index),
      v,
    ]),
  );

  for (const v of variantRows) {
    const existingVariant = await db
      .collection(Collections.Variants)
      .doc(v.variantId)
      .get();
    const prior = existingVariant.exists ? (existingVariant.data() as Variant) : null;
    const editorV =
      editorVariantByKey.get(v.variantId) ??
      editorVariantByKey.get(v.shopifyGid) ??
      editorInput.variants[v.position ?? 0];
    const onHand =
      prior != null
        ? (prior.on_hand_total ?? 0)
        : (editorV?.on_hand ?? ("onHand" in v ? v.onHand : 0) ?? 0);
    const reserved = prior?.reserved_total ?? 0;
    const variantDoc: Omit<
      Variant,
      "updated_at" | "on_hand_total" | "reserved_total" | "available"
    > & { updated_at: FirebaseFirestore.FieldValue } = {
      id: v.variantId,
      shop_id: normalizeShopId(input.shopId),
      product_id: productId,
      shopify_gid: v.shopifyGid,
      inventory_item_gid:
        v.inventoryItemGid ?? prior?.inventory_item_gid ?? `local://${v.variantId}`,
      sku: v.sku,
      barcode: v.barcode,
      title: v.title,
      image_url: editorV?.image_url ?? v.imageUrl,
      price_cents: v.priceCents,
      compare_at_price_cents: v.compareAtPriceCents,
      currency: prior?.currency ?? null,
      option1: v.option1,
      option2: v.option2,
      option3: v.option3,
      position: v.position,
      inventory_tracked: editorV?.inventory_tracked ?? prior?.inventory_tracked ?? true,
      inventory_policy: editorV?.inventory_policy ?? prior?.inventory_policy ?? "DENY",
      unit_cost_cents: editorV?.unit_cost_cents ?? prior?.unit_cost_cents ?? null,
      updated_at: FieldValue.serverTimestamp(),
    };
    batch.set(
      db.collection(Collections.Variants).doc(v.variantId),
      {
        ...variantDoc,
        on_hand_total: onHand,
        reserved_total: reserved,
        available: Math.max(0, onHand - reserved),
      },
      { merge: true },
    );
  }

  const keptVariantIds = new Set(variantRows.map((v) => v.variantId));
  for (const prior of priorVariants) {
    if (!keptVariantIds.has(prior.id)) {
      batch.delete(db.collection(Collections.Variants).doc(prior.id));
    }
  }

  await batch.commit();

  if (input.userId && !cfg.batches_enabled) {
    const defaultLocationId = await getDefaultLocationId(input.shopId);
    for (const v of variantRows) {
      const prior = priorVariants.find((p) => p.id === v.variantId);
      if (prior) continue;
      const editorV =
        editorVariantByKey.get(v.variantId) ??
        editorVariantByKey.get(v.shopifyGid) ??
        null;
      if (!editorV) continue;
      const priorOnHand = 0;
      if (editorV.on_hand === priorOnHand) continue;

      if (defaultLocationId) {
        try {
          await adjustVariantStock({
            variantId: v.variantId,
            locationId: defaultLocationId,
            newOnHand: editorV.on_hand,
            reason: "Product editor",
            userId: input.userId,
          });
        } catch (e) {
          log.warn("product_editor_stock_adjust_failed", {
            variantId: v.variantId,
            error: String(e),
          });
        }
      }
    }
  }
  log.info("product_editor_saved", {
    productId,
    shopId: input.shopId,
    syncedToShopify: shouldSync,
  });

  return { productId, syncedToShopify: shouldSync };
}
