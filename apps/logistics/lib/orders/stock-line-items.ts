/**
 * Shopify custom line items (manual orders, no catalog variant) are stored
 * and printed, but they are not stock. Every reservation, Charge assignment,
 * and inventory decrement must skip them.
 */

export function isStockLineItem<
  T extends { variant_id?: string | null; custom?: boolean | null },
>(li: T): li is T & { variant_id: string } {
  return (
    li.custom !== true &&
    typeof li.variant_id === "string" &&
    li.variant_id.length > 0
  );
}

export function stockLineItems<
  T extends { variant_id?: string | null; custom?: boolean | null },
>(items: readonly T[]): (T & { variant_id: string })[] {
  return items.filter(isStockLineItem);
}

/** Order has positions to show, none of which touch inventory. */
export function isDisplayOnlyOrder(
  items: readonly { variant_id?: string | null; custom?: boolean | null }[],
): boolean {
  return items.length > 0 && stockLineItems(items).length === 0;
}
