/**
 * `orders/edited` does NOT send a full Order resource. Payload shape:
 * `{ order_edit: { id, order_id, line_items: { additions, removals }, ... } }`.
 * We only need `order_id` to re-fetch the current order.
 */
export function extractOrderEditOrderId(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const edit = (body as { order_edit?: unknown }).order_edit;
  if (!edit || typeof edit !== "object") return null;
  const orderId = (edit as { order_id?: unknown }).order_id;
  if (typeof orderId === "number" && Number.isFinite(orderId)) return orderId;
  if (typeof orderId === "string" && /^\d+$/.test(orderId)) {
    return Number.parseInt(orderId, 10);
  }
  return null;
}
