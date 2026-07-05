/**
 * Namespaces required by client components (`useTranslations`).
 * Server-only pages load the full catalog via `getTranslations`; the root
 * layout only hydrates these keys to shrink the RSC payload.
 */
const CLIENT_NAMESPACES = [
  "common",
  "nav",
  "adminJobs",
  "orderNote",
  "picking",
  "packedOrders",
  "packing",
  "services",
  "packingPage",
  "pickingDetail",
  "bins",
  "binLabels",
  "productLabels",
  "scan",
  "pickScan",
  "confirmPacking",
  "pickRun",
  "ordersAdmin",
  "products",
  "productEditor",
  "lagerbestand",
  "batches",
  "customers",
  "settings",
] as const;

export function pickClientMessages(
  messages: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of CLIENT_NAMESPACES) {
    if (key in messages) out[key] = messages[key];
  }
  return out;
}
