import type { Order } from "@/server/firestore/schema";

/** Recent-list size when no search query is set. */
export const ORDER_LIST_LIMIT = 100;

/** How many hits the search returns. */
export const ORDER_SEARCH_MATCH_LIMIT = 100;

/** Page size while scanning the shop's orders for a search. */
export const ORDER_SEARCH_PAGE = 250;

/**
 * Hard stop so a query that matches nothing cannot read the collection
 * without bound. Covers the whole shop for the volumes this app serves.
 */
export const ORDER_SEARCH_SCAN_LIMIT = 5000;

const QUERY_MAX = 80;

export function normalizeOrderSearchQuery(raw: string | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, QUERY_MAX);
}

type SearchableOrder = Pick<Order, "id" | "name" | "tags" | "line_items"> &
  Partial<
    Pick<
      Order,
      | "lieferschein_no"
      | "local_tags"
      | "customer"
      | "shipping_address"
      | "dhl_shipment"
    >
  >;

function push(parts: string[], value: string | null | undefined) {
  if (value) parts.push(value);
}

/** Case-insensitive token search. Every whitespace-separated token must match. */
export function orderMatchesQuery(order: SearchableOrder, raw: string): boolean {
  const tokens = normalizeOrderSearchQuery(raw).toLowerCase().split(" ").filter(Boolean);
  if (tokens.length === 0) return true;

  const parts: string[] = [order.id, order.name];
  if (order.name.startsWith("#")) parts.push(order.name.slice(1));
  push(parts, order.lieferschein_no);
  push(parts, order.dhl_shipment?.shipment_no);
  for (const tag of order.tags) push(parts, tag);
  for (const tag of order.local_tags ?? []) push(parts, tag);

  const customer = order.customer;
  if (customer) {
    push(parts, customer.email);
    push(parts, customer.first_name);
    push(parts, customer.last_name);
  }

  const address = order.shipping_address;
  if (address) {
    push(parts, address.first_name);
    push(parts, address.last_name);
    push(parts, address.company);
    push(parts, address.address1);
    push(parts, address.zip);
    push(parts, address.city);
    push(parts, address.phone);
  }

  for (const li of order.line_items) {
    push(parts, li.title);
    push(parts, li.sku);
  }

  const haystack = parts.join("\n").toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}
