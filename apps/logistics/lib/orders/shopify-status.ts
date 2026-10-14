/**
 * Canonical Shopify order statuses used as the SHIP gate.
 *
 * REST webhooks send lowercase (`paid`, `partial`, null = unfulfilled).
 * GraphQL backfill sends the display enums (`PAID`, `UNFULFILLED`).
 * Both are normalized onto these values before the allowlist check.
 */
export const SHOPIFY_PAYMENT_STATUSES = [
  "PENDING",
  "AUTHORIZED",
  "PARTIALLY_PAID",
  "PAID",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "VOIDED",
  "EXPIRED",
] as const;

export const SHOPIFY_FULFILLMENT_STATUSES = [
  "UNFULFILLED",
  "PARTIALLY_FULFILLED",
  "FULFILLED",
  "RESTOCKED",
  "PENDING_FULFILLMENT",
  "OPEN",
  "IN_PROGRESS",
  "ON_HOLD",
  "SCHEDULED",
  "REQUEST_DECLINED",
] as const;

export type ShopifyPaymentStatus = (typeof SHOPIFY_PAYMENT_STATUSES)[number];
export type ShopifyFulfillmentStatus =
  (typeof SHOPIFY_FULFILLMENT_STATUSES)[number];

export type ShipStatusBlockReason = "PAYMENT_STATUS" | "FULFILLMENT_STATUS";

/** German labels for the admin settings form (settings UI is German-only). */
export const SHOPIFY_PAYMENT_STATUS_LABELS: Record<ShopifyPaymentStatus, string> =
  {
    PENDING: "Ausstehend",
    AUTHORIZED: "Autorisiert",
    PARTIALLY_PAID: "Teilweise bezahlt",
    PAID: "Bezahlt",
    PARTIALLY_REFUNDED: "Teilweise erstattet",
    REFUNDED: "Erstattet",
    VOIDED: "Ungültig",
    EXPIRED: "Abgelaufen",
  };

export const SHOPIFY_FULFILLMENT_STATUS_LABELS: Record<
  ShopifyFulfillmentStatus,
  string
> = {
  UNFULFILLED: "Nicht ausgeführt",
  PARTIALLY_FULFILLED: "Teilweise ausgeführt",
  FULFILLED: "Ausgeführt",
  RESTOCKED: "Wieder eingelagert",
  PENDING_FULFILLMENT: "Ausführung ausstehend",
  OPEN: "Offen",
  IN_PROGRESS: "In Bearbeitung",
  ON_HOLD: "Zurückgestellt",
  SCHEDULED: "Geplant",
  REQUEST_DECLINED: "Anfrage abgelehnt",
};

const PAYMENT_SET = new Set<string>(SHOPIFY_PAYMENT_STATUSES);
const FULFILLMENT_SET = new Set<string>(SHOPIFY_FULFILLMENT_STATUSES);

export function normalizePaymentStatus(
  status: string | null | undefined,
): string | null {
  if (!status?.trim()) return null;
  return status.trim().toUpperCase();
}

/**
 * REST `fulfillment_status: null` means the order is not fulfilled.
 * `partial` is the REST spelling of `PARTIALLY_FULFILLED`.
 */
export function normalizeFulfillmentStatus(
  status: string | null | undefined,
): string | null {
  if (status == null || !String(status).trim()) return "UNFULFILLED";
  const key = String(status).trim().toUpperCase();
  if (key === "PARTIAL") return "PARTIALLY_FULFILLED";
  if (key === "NULL") return "UNFULFILLED";
  return key;
}

/**
 * Allowlist match.
 *
 * Every known status selected = no extra gate (null and unknown values still
 * pass). That keeps shops that have not narrowed the list on the old
 * inventory-only behaviour. A shorter list is a real allowlist: null and
 * unknown values do not match.
 */
export function statusInAllowlist(
  normalized: string | null,
  allow: readonly string[],
  universe: readonly string[],
): boolean {
  const allowSet = new Set(allow.map((s) => s.toUpperCase()));
  const unrestricted = universe.every((s) => allowSet.has(s));
  if (unrestricted) return true;
  if (!normalized) return false;
  return allowSet.has(normalized);
}

/**
 * Why this order must not become SHIP, before inventory is considered.
 * `null` means the configured statuses allow it.
 */
export function shipStatusBlockReason(
  financialStatus: string | null | undefined,
  fulfillmentStatus: string | null | undefined,
  paymentAllow: readonly string[],
  fulfillmentAllow: readonly string[],
): ShipStatusBlockReason | null {
  if (
    !statusInAllowlist(
      normalizePaymentStatus(financialStatus),
      paymentAllow,
      SHOPIFY_PAYMENT_STATUSES,
    )
  ) {
    return "PAYMENT_STATUS";
  }
  if (
    !statusInAllowlist(
      normalizeFulfillmentStatus(fulfillmentStatus),
      fulfillmentAllow,
      SHOPIFY_FULFILLMENT_STATUSES,
    )
  ) {
    return "FULFILLMENT_STATUS";
  }
  return null;
}

export function paymentChipClass(status: string | null): string {
  if (status === "PAID" || status === "PARTIALLY_REFUNDED") {
    return "chip chip-emerald";
  }
  if (
    status === "PENDING" ||
    status === "AUTHORIZED" ||
    status === "PARTIALLY_PAID" ||
    status === "EXPIRED"
  ) {
    return "chip chip-amber";
  }
  return "chip chip-soft";
}

export function fulfillmentChipClass(status: string | null): string {
  if (status === "FULFILLED") return "chip chip-emerald";
  if (
    status === "UNFULFILLED" ||
    status === "OPEN" ||
    status === "IN_PROGRESS" ||
    status === "PENDING_FULFILLMENT" ||
    status === "SCHEDULED"
  ) {
    return "chip chip-sky";
  }
  if (status === "PARTIALLY_FULFILLED" || status === "ON_HOLD") {
    return "chip chip-amber";
  }
  return "chip chip-soft";
}

export function lagerStatusChipClass(status: string): string {
  if (status === "SHIP") return "chip chip-emerald";
  if (status === "PICKING") return "chip chip-violet";
  if (status === "STOP") return "chip chip-amber";
  if (status === "PACKED") return "chip chip-sky";
  return "chip chip-soft";
}

export function isKnownPaymentStatus(
  status: string,
): status is ShopifyPaymentStatus {
  return PAYMENT_SET.has(status);
}

export function isKnownFulfillmentStatus(
  status: string,
): status is ShopifyFulfillmentStatus {
  return FULFILLMENT_SET.has(status);
}
