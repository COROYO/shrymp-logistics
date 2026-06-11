import type { Allocation, Order } from "@/server/firestore/schema";

function coversAllLineItems(
  lineItems: Order["line_items"],
  open: { data: Pick<Allocation, "line_item_id" | "qty"> }[],
): boolean {
  const assignedByLi = new Map<string, number>();
  for (const a of open) {
    assignedByLi.set(
      a.data.line_item_id,
      (assignedByLi.get(a.data.line_item_id) ?? 0) + a.data.qty,
    );
  }
  for (const li of lineItems) {
    if ((assignedByLi.get(li.id) ?? 0) !== li.qty) return false;
  }
  return assignedByLi.size === new Set(lineItems.map((li) => li.id)).size;
}

/** Whether open Charge assignments fully cover every line item. */
export function orderAssignmentCoversLineItems(
  lineItems: Order["line_items"],
  allocs: Pick<Allocation, "line_item_id" | "qty" | "consumed_at">[],
): boolean {
  const open = allocs.filter((a) => !a.consumed_at);
  return coversAllLineItems(lineItems, open.map((data) => ({ data })));
}
