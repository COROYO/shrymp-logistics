/**
 * Extended Shopify product shape used by catalog sync (F.3).
 * Kept separate from the slim inventory-focused node in queries re-exports.
 */

export type ShopifyCatalogMediaNode = {
  id?: string;
  alt?: string | null;
  image?: { url: string } | null;
};

export type ShopifyCatalogVariantNode = {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: string | null | { amount?: string | null };
  compareAtPrice: string | null | { amount?: string | null };
  inventoryPolicy: "DENY" | "CONTINUE";
  inventoryQuantity: number | null;
  selectedOptions: Array<{ name: string; value: string }>;
  image: { url: string } | null;
  inventoryItem: {
    id: string;
    sku?: string | null;
    tracked: boolean;
    unitCost: { amount: string } | null;
  } | null;
};

export type ShopifyCatalogProductNode = {
  id: string;
  title: string;
  handle: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  updatedAt: string;
  descriptionHtml: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  hasVariantsThatRequiresComponents: boolean;
  seo: { title: string | null; description: string | null } | null;
  options: Array<{ name: string; position: number; values: string[] }>;
  collections: { nodes: Array<{ id: string }> };
  media: { nodes: ShopifyCatalogMediaNode[] };
  metafields: {
    nodes: Array<{
      namespace: string;
      key: string;
      type?: string | { name?: string | null } | null;
      value?: string | null;
      jsonValue?: unknown;
    }>;
  };
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  variants: { nodes: ShopifyCatalogVariantNode[] };
};
