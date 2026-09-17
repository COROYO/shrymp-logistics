import type { Order } from "@/server/firestore/schema";
import { effectiveOrderTags as mergeTags } from "@/lib/lager/priority-tags";

/** Re-export — Shopify tags ∪ local automation tags. */
export function effectiveOrderTags(
  order: Pick<Order, "tags" | "local_tags">,
): string[] {
  return mergeTags(order);
}

/** Keep local automation gifts when Shopify line items are re-mirrored. */
export function mergeAutomationLineItems<
  T extends { id: string; source?: string },
>(shopifyItems: T[], previous: T[] | undefined): T[] {
  const gifts = (previous ?? []).filter((li) => li.source === "automation");
  if (gifts.length === 0) return shopifyItems;
  const ids = new Set(shopifyItems.map((i) => i.id));
  return [...shopifyItems, ...gifts.filter((g) => !ids.has(g.id))];
}
