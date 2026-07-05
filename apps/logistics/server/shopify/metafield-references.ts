import "server-only";
import { shopifyGraphQL } from "./client";

export type MetafieldReferenceOption = {
  gid: string;
  label: string;
  subtitle?: string | null;
};

const RESOLVE_NODES_QUERY = /* GraphQL */ `
  query ResolveMetafieldReferenceNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      id
      ... on Product {
        title
      }
      ... on ProductVariant {
        displayName
        sku
        product {
          title
        }
      }
      ... on Collection {
        title
      }
      ... on Page {
        title
      }
      ... on GenericFile {
        alt
        url
      }
      ... on MediaImage {
        alt
        image {
          url
        }
      }
      ... on Metaobject {
        displayName
        handle
      }
    }
  }
`;

const SEARCH_PRODUCTS_QUERY = /* GraphQL */ `
  query SearchProductsForMetafield($query: String!) {
    products(first: 15, query: $query) {
      nodes {
        id
        title
        handle
      }
    }
  }
`;

const SEARCH_VARIANTS_QUERY = /* GraphQL */ `
  query SearchVariantsForMetafield($query: String!) {
    productVariants(first: 15, query: $query) {
      nodes {
        id
        displayName
        sku
        product {
          title
        }
      }
    }
  }
`;

const SEARCH_COLLECTIONS_QUERY = /* GraphQL */ `
  query SearchCollectionsForMetafield($query: String!) {
    collections(first: 15, query: $query) {
      nodes {
        id
        title
        handle
      }
    }
  }
`;

const SEARCH_PAGES_QUERY = /* GraphQL */ `
  query SearchPagesForMetafield($query: String!) {
    pages(first: 15, query: $query) {
      nodes {
        id
        title
        handle
      }
    }
  }
`;

const SEARCH_FILES_QUERY = /* GraphQL */ `
  query SearchFilesForMetafield($query: String!) {
    files(first: 15, query: $query) {
      nodes {
        ... on GenericFile {
          id
          alt
          url
        }
        ... on MediaImage {
          id
          alt
          image {
            url
          }
        }
      }
    }
  }
`;

const METOBJECT_DEFINITION_TYPE_QUERY = /* GraphQL */ `
  query MetaobjectDefinitionTypeForSearch($id: ID!) {
    metaobjectDefinition(id: $id) {
      type
    }
  }
`;

const SEARCH_METOBJECTS_QUERY = /* GraphQL */ `
  query SearchMetaobjectsForMetafield($type: String!, $query: String!) {
    metaobjects(first: 15, type: $type, query: $query) {
      nodes {
        id
        displayName
        handle
      }
    }
  }
`;

type ResolvedNode = {
  id?: string;
  title?: string | null;
  displayName?: string | null;
  handle?: string | null;
  sku?: string | null;
  alt?: string | null;
  url?: string | null;
  image?: { url?: string | null } | null;
  product?: { title?: string | null } | null;
};

function labelFromNode(node: ResolvedNode | null | undefined): string | null {
  if (!node?.id) return null;
  if (node.displayName?.trim()) return node.displayName.trim();
  if (node.title?.trim()) return node.title.trim();
  if (node.alt?.trim()) return node.alt.trim();
  if (node.handle?.trim()) return node.handle.trim();
  if (node.url?.trim()) {
    const parts = node.url.split("/");
    return parts[parts.length - 1] || node.url;
  }
  return node.id;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Shopify metaobjects query uses definition type handle, not definition GID. */
async function metaobjectSearchType(
  metaobjectDefinitionId: string,
  shopId?: string,
): Promise<string | null> {
  const raw = metaobjectDefinitionId.trim();
  if (!raw) return null;
  if (!raw.startsWith("gid://")) return raw;
  try {
    const data = await shopifyGraphQL<{
      metaobjectDefinition: { type: string } | null;
    }>(
      METOBJECT_DEFINITION_TYPE_QUERY,
      { id: raw },
      shopId ? { shopId } : undefined,
    );
    return data.metaobjectDefinition?.type?.trim() || null;
  } catch {
    return null;
  }
}

export async function resolveMetafieldReferenceLabels(
  gids: string[],
  shopId?: string,
): Promise<Record<string, string>> {
  const ids = [...new Set(gids.filter(Boolean))];
  if (ids.length === 0) return {};
  const out: Record<string, string> = {};
  for (const batch of chunk(ids, 50)) {
    try {
      const data = await shopifyGraphQL<{ nodes: Array<ResolvedNode | null> }>(
        RESOLVE_NODES_QUERY,
        { ids: batch },
        shopId ? { shopId } : undefined,
      );
      for (const node of data.nodes) {
        const label = labelFromNode(node);
        if (node?.id && label) out[node.id] = label;
      }
    } catch {
      for (const id of batch) {
        if (!out[id]) out[id] = id;
      }
    }
  }
  return out;
}

export async function searchMetafieldReferences(input: {
  kind:
    | "product"
    | "variant"
    | "collection"
    | "page"
    | "file"
    | "metaobject";
  query: string;
  shopId?: string;
  metaobjectDefinitionId?: string | null;
}): Promise<MetafieldReferenceOption[]> {
  const q = input.query.trim();
  if (q.length < 1) return [];

  switch (input.kind) {
    case "product": {
      const data = await shopifyGraphQL<{
        products: { nodes: Array<{ id: string; title: string; handle: string }> };
      }>(SEARCH_PRODUCTS_QUERY, { query: q }, input.shopId ? { shopId: input.shopId } : undefined);
      return data.products.nodes.map((p) => ({
        gid: p.id,
        label: p.title,
        subtitle: p.handle,
      }));
    }
    case "variant": {
      const data = await shopifyGraphQL<{
        productVariants: {
          nodes: Array<{
            id: string;
            displayName: string;
            sku: string | null;
            product: { title: string };
          }>;
        };
      }>(SEARCH_VARIANTS_QUERY, { query: q }, input.shopId ? { shopId: input.shopId } : undefined);
      return data.productVariants.nodes.map((v) => ({
        gid: v.id,
        label: v.displayName || v.product.title,
        subtitle: [v.product.title, v.sku].filter(Boolean).join(" · "),
      }));
    }
    case "collection": {
      const data = await shopifyGraphQL<{
        collections: { nodes: Array<{ id: string; title: string; handle: string }> };
      }>(SEARCH_COLLECTIONS_QUERY, { query: q }, input.shopId ? { shopId: input.shopId } : undefined);
      return data.collections.nodes.map((c) => ({
        gid: c.id,
        label: c.title,
        subtitle: c.handle,
      }));
    }
    case "page": {
      const data = await shopifyGraphQL<{
        pages: { nodes: Array<{ id: string; title: string; handle: string }> };
      }>(SEARCH_PAGES_QUERY, { query: q }, input.shopId ? { shopId: input.shopId } : undefined);
      return data.pages.nodes.map((p) => ({
        gid: p.id,
        label: p.title,
        subtitle: p.handle,
      }));
    }
    case "file": {
      const data = await shopifyGraphQL<{
        files: { nodes: Array<ResolvedNode | null> };
      }>(SEARCH_FILES_QUERY, { query: q }, input.shopId ? { shopId: input.shopId } : undefined);
      return data.files.nodes
        .filter((n): n is ResolvedNode => Boolean(n?.id))
        .map((node) => ({
          gid: node.id!,
          label: labelFromNode(node) ?? node.id!,
          subtitle: node.url ?? node.image?.url ?? null,
        }));
    }
    case "metaobject": {
      const definitionRef = input.metaobjectDefinitionId?.trim();
      if (!definitionRef) return [];
      const type = await metaobjectSearchType(definitionRef, input.shopId);
      if (!type) return [];
      const data = await shopifyGraphQL<{
        metaobjects: {
          nodes: Array<{ id: string; displayName: string; handle: string }>;
        };
      }>(
        SEARCH_METOBJECTS_QUERY,
        { type, query: q },
        input.shopId ? { shopId: input.shopId } : undefined,
      );
      return data.metaobjects.nodes.map((m) => ({
        gid: m.id,
        label: m.displayName || m.handle,
        subtitle: m.handle,
      }));
    }
    default:
      return [];
  }
}
