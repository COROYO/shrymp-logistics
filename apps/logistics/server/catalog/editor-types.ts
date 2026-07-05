import { z } from "zod";
import type { VariantRow } from "@/app/admin/products/product-accordion";
import type { LocationOption } from "@/server/locations/stock";

export const ProductEditorVariantSchema = z.object({
  id: z.string().optional(),
  shopify_gid: z.string().optional(),
  title: z.string().default("Default Title"),
  sku: z.string().nullable().default(null),
  barcode: z.string().nullable().default(null),
  price_cents: z.number().int().nonnegative().nullable().default(null),
  compare_at_price_cents: z.number().int().nonnegative().nullable().default(null),
  image_url: z.string().url().nullable().default(null),
  /** Shopify MediaImage GID when known — used to assign variant images. */
  image_media_id: z.string().nullable().optional(),
  option1: z.string().nullable().default(null),
  option2: z.string().nullable().default(null),
  option3: z.string().nullable().default(null),
  position: z.number().int().nonnegative().default(0),
  /** Physical stock (pieces) — mirrors variant on_hand_total / primary location. */
  on_hand: z.number().int().nonnegative().default(0),
  /** Shopify InventoryItem.tracked */
  inventory_tracked: z.boolean().default(true),
  /** Shopify ProductVariant.inventoryPolicy */
  inventory_policy: z.enum(["DENY", "CONTINUE"]).default("DENY"),
  /** Shopify InventoryItem.unitCost in smallest currency unit. */
  unit_cost_cents: z.number().int().nonnegative().nullable().default(null),
});

export const ProductEditorMediaSchema = z.object({
  id: z.string().optional(),
  url: z.string().url(),
  alt: z.string().nullable().default(null),
  position: z.number().int().nonnegative(),
});

export const ProductEditorMetafieldSchema = z.object({
  namespace: z.string().min(1),
  key: z.string().min(1),
  type: z.string().min(1),
  value: z.string(),
  /** Shopify metafield definition display name (read-only in UI). */
  name: z.string().nullable().optional(),
  /** For metaobject_reference fields — from definition validations. */
  metaobject_definition_id: z.string().nullable().optional(),
});

export const ProductEditorOptionSchema = z.object({
  name: z.string().min(1),
  position: z.number().int(),
  values: z.array(z.string()),
});

export const ProductEditorInputSchema = z.object({
  product_id: z.string().optional(),
  title: z.string().min(1),
  handle: z.string().default(""),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]),
  description_html: z.string().nullable().default(null),
  vendor: z.string().nullable().default(null),
  product_type: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  seo_title: z.string().nullable().default(null),
  seo_description: z.string().nullable().default(null),
  collection_ids: z.array(z.string()).default([]),
  media: z.array(ProductEditorMediaSchema).default([]),
  options: z.array(ProductEditorOptionSchema).default([]),
  metafields: z.array(ProductEditorMetafieldSchema).default([]),
  variants: z.array(ProductEditorVariantSchema).min(1),
  sync_to_shopify: z.boolean().default(true),
});

export type ProductEditorInput = z.infer<typeof ProductEditorInputSchema>;
export type ProductEditorVariant = z.infer<typeof ProductEditorVariantSchema>;
export type ProductEditorOption = z.infer<typeof ProductEditorOptionSchema>;

export type CollectionOption = {
  id: string;
  shopify_gid: string;
  title: string;
  handle: string;
};

export type ProductEditorPayload = {
  productId: string;
  shopifyGid: string | null;
  isNew: boolean;
  defaultSyncToShopify: boolean;
  input: ProductEditorFormInput;
  collections: CollectionOption[];
  /** Matches Lagerbestand / Chargen view when product exists locally. */
  batchesEnabled: boolean;
  variantInventory: VariantRow[];
  inventoryLocations: LocationOption[];
  defaultLocationId: string | null;
};

export type ProductEditorFormInput = Omit<
  ProductEditorInput,
  "product_id" | "sync_to_shopify"
>;
