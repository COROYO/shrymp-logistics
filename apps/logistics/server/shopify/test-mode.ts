import "server-only";
import { cache } from "react";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import { Collections, TestModeLogSchema } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { getShop } from "@/server/tenant/shop";
import { getTenantShopIdFromContext } from "@/server/tenant/context";
import { DEFAULT_TEST_MODE } from "@/lib/lager/defaults";
import { normalizeShopId } from "@/server/tenant/id";

/** Mutations that return IDs persisted locally — must not be mocked. */
const BLOCKING_MUTATION_FIELDS = new Set([
  "locationAdd",
  "productSet",
  "productCreate",
  "stagedUploadsCreate",
]);

export class ShopifyTestModeSkippedError extends Error {
  constructor(message = "SHOPIFY_TEST_MODE: mutation blocked") {
    super(message);
    this.name = "ShopifyTestModeSkippedError";
  }
}

function resolveShopId(shopId?: string): string {
  const id = shopId ?? getTenantShopIdFromContext();
  if (!id) {
    throw new Error("shopId required for Shopify test mode");
  }
  return normalizeShopId(id);
}

async function isShopifyTestModeUncached(shopId?: string): Promise<boolean> {
  const id = resolveShopId(shopId);
  const shop = await getShop(id);
  if (!shop) return DEFAULT_TEST_MODE;
  return shop.test_mode ?? DEFAULT_TEST_MODE;
}

export const isShopifyTestMode = cache(isShopifyTestModeUncached);

export function isGraphQLMutation(query: string): boolean {
  return /^\s*mutation\b/im.test(query);
}

export function extractMutationRootField(query: string): string {
  const match = query.match(/\{\s*(\w+)\s*[\(@]/);
  return match?.[1] ?? "unknown";
}

export function summarizeTestModeMutation(
  field: string,
  variables: unknown,
): string {
  const v = (variables ?? {}) as Record<string, unknown>;
  switch (field) {
    case "tagsAdd":
      return `Tags hinzufügen auf Bestellung ${String(v.id)}: ${fmtTags(v.tags)}`;
    case "tagsRemove":
      return `Tags entfernen von Bestellung ${String(v.id)}: ${fmtTags(v.tags)}`;
    case "inventorySetOnHandQuantities": {
      const rows = (v.input as { setQuantities?: unknown[] })?.setQuantities ?? [];
      return `Bestand setzen (${rows.length} Position${rows.length === 1 ? "" : "en"}) — Grund: ${String((v.input as { reason?: string })?.reason ?? "—")}`;
    }
    case "fulfillmentCreate":
      return `Fulfillment erstellen${v.fulfillment ? "" : ""} (notify: ${String((v.fulfillment as { notifyCustomer?: boolean })?.notifyCustomer ?? true)})`;
    case "locationAdd":
      return `Standort anlegen: ${String((v.input as { name?: string })?.name ?? "—")}`;
    case "productUpdate":
      return `Produkt-Titel ändern: ${String((v.product as { title?: string })?.title ?? "—")}`;
    case "inventoryItemUpdate":
      return `SKU ändern auf InventoryItem ${String(v.id)} → ${String((v.input as { sku?: string | null })?.sku ?? "null")}`;
    case "productSet":
      return `Produkt aktualisieren: ${String((v.input as { title?: string })?.title ?? "—")}`;
    case "productCreate":
      return `Produkt anlegen: ${String((v.product as { title?: string })?.title ?? "—")}`;
    case "productCreateMedia":
      return `Produkt-Medien hinzufügen zu ${String(v.productId)}`;
    case "productVariantAppendMedia":
      return `Varianten-Medien verknüpfen`;
    case "productVariantDetachMedia":
      return `Varianten-Medien trennen`;
    case "webhookSubscriptionCreate":
      return `Webhook registrieren: ${String(v.topic)}`;
    case "webhookSubscriptionDelete":
      return `Webhook löschen: ${String(v.id)}`;
    case "stagedUploadsCreate":
      return `Produktbild hochladen (staged upload)`;
    default:
      return `Shopify-Mutation ${field}`;
  }
}

function fmtTags(tags: unknown): string {
  if (!Array.isArray(tags)) return "—";
  return tags.map(String).join(", ") || "—";
}

export async function logTestModeMutation(opts: {
  shopId: string;
  mutation: string;
  summary: string;
  variables?: unknown;
}): Promise<void> {
  const shopId = normalizeShopId(opts.shopId);
  const db = adminDb();
  const ref = db.collection(Collections.TestModeLog).doc();
  const entry = {
    id: ref.id,
    shop_id: shopId,
    mutation: opts.mutation,
    summary: opts.summary,
    variables: opts.variables ?? null,
    created_at: FieldValue.serverTimestamp(),
  };
  await ref.set(entry);
  log.info("shopify_test_mode_skipped", {
    shopId,
    mutation: opts.mutation,
    summary: opts.summary,
  });
}

export async function listTestModeLogEntries(
  shopId: string,
  limit = 50,
): Promise<
  Array<{
    id: string;
    mutation: string;
    summary: string;
    createdAtMs: number | null;
  }>
> {
  const snap = await adminDb()
    .collection(Collections.TestModeLog)
    .where("shop_id", "==", normalizeShopId(shopId))
    .orderBy("created_at", "desc")
    .limit(limit)
    .get();

  const out: Array<{
    id: string;
    mutation: string;
    summary: string;
    createdAtMs: number | null;
  }> = [];

  for (const doc of snap.docs) {
    const parsed = TestModeLogSchema.safeParse({ id: doc.id, ...doc.data() });
    if (!parsed.success) continue;
    const ts = parsed.data.created_at as { toMillis?: () => number };
    out.push({
      id: parsed.data.id,
      mutation: parsed.data.mutation,
      summary: parsed.data.summary,
      createdAtMs:
        typeof ts?.toMillis === "function" ? ts.toMillis() : null,
    });
  }
  return out;
}

export function buildTestModeMutationMock(
  field: string,
  variables: unknown,
): Record<string, unknown> {
  const base = { userErrors: [] as unknown[] };
  const v = (variables ?? {}) as Record<string, unknown>;

  switch (field) {
    case "tagsAdd":
    case "tagsRemove":
      return { [field]: { ...base, node: { id: v.id ?? "gid://shopify/Order/0" } } };
    case "inventorySetOnHandQuantities":
      return {
        [field]: {
          ...base,
          inventoryAdjustmentGroup: {
            createdAt: new Date().toISOString(),
            changes: [],
          },
        },
      };
    case "fulfillmentCreate":
      return {
        [field]: {
          ...base,
          fulfillment: {
            id: "gid://shopify/Fulfillment/0",
            status: "SUCCESS",
          },
        },
      };
    case "productUpdate":
      return {
        [field]: {
          ...base,
          product: {
            id: (v.product as { id?: string })?.id ?? "gid://shopify/Product/0",
            title: (v.product as { title?: string })?.title ?? "",
          },
        },
      };
    case "inventoryItemUpdate":
      return {
        [field]: {
          ...base,
          inventoryItem: {
            id: v.id ?? "gid://shopify/InventoryItem/0",
            sku: (v.input as { sku?: string | null })?.sku ?? null,
          },
        },
      };
    case "webhookSubscriptionCreate":
      return {
        [field]: {
          ...base,
          webhookSubscription: { id: "gid://shopify/WebhookSubscription/0" },
        },
      };
    case "webhookSubscriptionDelete":
      return {
        [field]: {
          ...base,
          deletedWebhookSubscriptionId: v.id ?? "gid://shopify/WebhookSubscription/0",
        },
      };
    case "productCreateMedia":
      return { [field]: { mediaUserErrors: [], media: [] } };
    case "productVariantAppendMedia":
      return { [field]: { ...base, productVariants: [] } };
    case "productVariantDetachMedia":
      return { [field]: { ...base, productVariants: [] } };
    default:
      return { [field]: base };
  }
}

export async function handleTestModeGraphQLMutation<TData>(opts: {
  query: string;
  variables?: unknown;
  shopId: string;
}): Promise<TData | null> {
  const field = extractMutationRootField(opts.query);
  const summary = summarizeTestModeMutation(field, opts.variables);

  await logTestModeMutation({
    shopId: opts.shopId,
    mutation: field,
    summary,
    variables: opts.variables,
  });

  if (BLOCKING_MUTATION_FIELDS.has(field)) {
    throw new ShopifyTestModeSkippedError(
      `Testmodus aktiv — ${summary}`,
    );
  }

  return buildTestModeMutationMock(field, opts.variables) as TData;
}
