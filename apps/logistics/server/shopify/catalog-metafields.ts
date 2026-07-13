import "server-only";
import { shopifyGraphQL } from "./client";
import type { ProductMetafield } from "@/server/firestore/schema";

export type ShopifyMetafieldNode = {
  namespace: string;
  key: string;
  type: string;
  value: string;
};

export type ProductMetafieldDefinitionRow = {
  namespace: string;
  key: string;
  name: string | null;
  type: string;
  metaobject_definition_id?: string | null;
};

const PRODUCT_METAFIELDS_PAGE_QUERY = /* GraphQL */ `
  query ProductMetafieldsPage($id: ID!, $cursor: String) {
    product(id: $id) {
      metafields(first: 250, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          namespace
          key
          value
          jsonValue
          type
        }
      }
    }
  }
`;

const METAFIELD_DEFINITIONS_PAGE_QUERY = /* GraphQL */ `
  query ProductMetafieldDefinitionsPage($cursor: String) {
    metafieldDefinitions(
      first: 100
      after: $cursor
      ownerType: PRODUCT
      constraintStatus: CONSTRAINED_AND_UNCONSTRAINED
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        namespace
        key
        name
        type {
          name
        }
        validations {
          name
          value
        }
      }
    }
  }
`;

const PRODUCT_SCOPED_DEFINITIONS_QUERY = /* GraphQL */ `
  query ProductScopedMetafieldDefinitions($id: ID!, $cursor: String) {
    product(id: $id) {
      metafieldDefinitions(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          namespace
          key
          name
          type {
            name
          }
          validations {
            name
            value
          }
        }
      }
    }
  }
`;

export function metafieldEditorKey(namespace: string, key: string): string {
  return `${namespace.trim()}\0${key.trim()}`;
}

function metaobjectDefinitionIdFromValidations(
  validations: Array<{ name: string; value: string }> | undefined,
): string | null {
  if (!validations?.length) return null;
  const hit = validations.find(
    (v) =>
      v.name === "metaobject_definition_id" ||
      v.name === "metaobjectDefinitionId",
  );
  return hit?.value?.trim() || null;
}

function mapDefinitionNode(node: {
  namespace: string;
  key: string;
  name: string | null;
  type?: { name?: string | null } | null;
  validations?: Array<{ name: string; value: string }>;
}): ProductMetafieldDefinitionRow {
  return {
    namespace: node.namespace,
    key: node.key,
    name: node.name,
    type: node.type?.name ?? "single_line_text_field",
    metaobject_definition_id: metaobjectDefinitionIdFromValidations(
      node.validations,
    ),
  };
}

/** Normalize Shopify metafield nodes for editor / Firestore storage. */
export function normalizeShopifyMetafieldNode(node: {
  namespace: string;
  key: string;
  type?: string | { name?: string | null } | null;
  value?: string | null;
  jsonValue?: unknown;
}): ShopifyMetafieldNode {
  const typeName =
    typeof node.type === "string"
      ? node.type
      : (node.type?.name ?? "single_line_text_field");
  let value = node.value ?? "";
  if (!value && node.jsonValue != null) {
    value =
      typeof node.jsonValue === "string"
        ? node.jsonValue
        : JSON.stringify(node.jsonValue);
  }
  return {
    namespace: node.namespace,
    key: node.key,
    type: typeName,
    value,
  };
}

export function mapShopifyMetafieldNodes(
  nodes: Array<{
    namespace: string;
    key: string;
    type?: string | { name?: string | null } | null;
    value?: string | null;
    jsonValue?: unknown;
  }>,
): ProductMetafield[] {
  return nodes.map((node) => normalizeShopifyMetafieldNode(node));
}

/** All metafield values on a product (paginated). */
export async function fetchAllProductMetafields(
  productGid: string,
  shopId?: string,
): Promise<ProductMetafield[]> {
  const out: ProductMetafield[] = [];
  let cursor: string | null = null;
  type ProductMetafieldsPageData = {
    product: {
      metafields: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          namespace: string;
          key: string;
          value?: string | null;
          jsonValue?: unknown;
          type?: { name?: string | null } | null;
        }>;
      };
    } | null;
  };
  for (let i = 0; i < 20; i++) {
    const data: ProductMetafieldsPageData = await shopifyGraphQL<ProductMetafieldsPageData>(
      PRODUCT_METAFIELDS_PAGE_QUERY,
      { id: productGid, cursor },
      shopId ? { shopId } : undefined,
    );
    const page = data.product?.metafields;
    if (!page) break;
    out.push(...mapShopifyMetafieldNodes(page.nodes));
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }
  return out;
}

function dedupeDefinitionRows(
  rows: ProductMetafieldDefinitionRow[],
): ProductMetafieldDefinitionRow[] {
  const byKey = new Map<string, ProductMetafieldDefinitionRow>();
  for (const row of rows) {
    byKey.set(metafieldEditorKey(row.namespace, row.key), row);
  }
  return [...byKey.values()].sort((a, b) =>
    `${a.namespace}.${a.key}`.localeCompare(`${b.namespace}.${b.key}`),
  );
}

async function fetchGlobalProductMetafieldDefinitions(
  shopId?: string,
): Promise<ProductMetafieldDefinitionRow[]> {
  const out: ProductMetafieldDefinitionRow[] = [];
  let cursor: string | null = null;
  type GlobalDefinitionsPageData = {
    metafieldDefinitions: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<{
        namespace: string;
        key: string;
        name: string | null;
        type?: { name?: string | null } | null;
      }>;
    };
  };
  for (let i = 0; i < 20; i++) {
    const data: GlobalDefinitionsPageData = await shopifyGraphQL<GlobalDefinitionsPageData>(
      METAFIELD_DEFINITIONS_PAGE_QUERY,
      { cursor },
      shopId ? { shopId } : undefined,
    );
    const page = data.metafieldDefinitions;
    for (const node of page.nodes) {
      out.push(mapDefinitionNode(node));
    }
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }
  return out;
}

async function fetchProductScopedMetafieldDefinitions(
  productGid: string,
  shopId?: string,
): Promise<ProductMetafieldDefinitionRow[]> {
  const out: ProductMetafieldDefinitionRow[] = [];
  let cursor: string | null = null;
  type ProductScopedDefinitionsPageData = {
    product: {
      metafieldDefinitions: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          namespace: string;
          key: string;
          name: string | null;
          type?: { name?: string | null } | null;
        }>;
      };
    } | null;
  };
  for (let i = 0; i < 20; i++) {
    const data: ProductScopedDefinitionsPageData =
      await shopifyGraphQL<ProductScopedDefinitionsPageData>(
      PRODUCT_SCOPED_DEFINITIONS_QUERY,
      { id: productGid, cursor },
      shopId ? { shopId } : undefined,
    );
    const page = data.product?.metafieldDefinitions;
    if (!page) break;
    for (const node of page.nodes) {
      out.push(mapDefinitionNode(node));
    }
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }
  return out;
}

/** Product metafield definitions (global + product/category-scoped). */
export async function fetchProductMetafieldDefinitions(
  shopId?: string,
  productGid?: string,
): Promise<ProductMetafieldDefinitionRow[]> {
  const [global, scoped] = await Promise.all([
    fetchGlobalProductMetafieldDefinitions(shopId),
    productGid
      ? fetchProductScopedMetafieldDefinitions(productGid, shopId)
      : Promise.resolve([]),
  ]);
  return dedupeDefinitionRows([...global, ...scoped]);
}

export type ProductEditorMetafieldRow = ProductMetafield & {
  name?: string | null;
  metaobject_definition_id?: string | null;
};

/** Merge live values with shop-wide product metafield definitions. */
export function mergeMetafieldsWithDefinitions(
  values: ProductMetafield[],
  definitions: ProductMetafieldDefinitionRow[],
): ProductEditorMetafieldRow[] {
  const byKey = new Map(
    values.map((v) => [metafieldEditorKey(v.namespace, v.key), v]),
  );
  const out: ProductEditorMetafieldRow[] = [];
  const seen = new Set<string>();

  for (const def of definitions) {
    const k = metafieldEditorKey(def.namespace, def.key);
    seen.add(k);
    const existing = byKey.get(k);
    out.push({
      namespace: def.namespace,
      key: def.key,
      type: existing?.type ?? def.type,
      value: existing?.value ?? "",
      name: def.name,
      metaobject_definition_id: def.metaobject_definition_id ?? null,
    });
  }

  for (const v of values) {
    const k = metafieldEditorKey(v.namespace, v.key);
    if (seen.has(k)) continue;
    out.push(v);
  }

  return out.sort((a, b) =>
    `${a.namespace}.${a.key}`.localeCompare(`${b.namespace}.${b.key}`),
  );
}

/** Prefer Shopify values; keep local-only rows not present remotely. */
export function mergeProductMetafieldValues(
  local: ProductMetafield[],
  remote: ProductMetafield[],
): ProductMetafield[] {
  if (remote.length === 0) return local;
  const remoteKeys = new Set(
    remote.map((m) => metafieldEditorKey(m.namespace, m.key)),
  );
  const extras = local.filter(
    (m) => !remoteKeys.has(metafieldEditorKey(m.namespace, m.key)),
  );
  return [...remote, ...extras].sort((a, b) =>
    `${a.namespace}.${a.key}`.localeCompare(`${b.namespace}.${b.key}`),
  );
}
