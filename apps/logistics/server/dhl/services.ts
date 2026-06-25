/**
 * Map Shopify shipping method → DHL Value Added Services (VAS).
 *
 * Detection is based on the order's primary shipping line (Versandmethode),
 * not on manual tags. Title + code are matched case-insensitively.
 */

import type { DhlConfig, Order, OrderShippingMethod } from "@/server/firestore/schema";
import type { DhlVAS } from "./types";

export type DhlServicesSummary = {
  cod: boolean;
  codAmountCents: number | null;
  codCurrency: string | null;
  premium: boolean;
  shippingMethodTitle: string | null;
};

export class DhlServicesError extends Error {
  constructor(
    public readonly code:
      | "cod_missing_amount"
      | "cod_missing_account_reference"
      | "cod_currency_not_eur",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "DhlServicesError";
  }
}

const COD_PATTERNS: RegExp[] = [
  /nachnahme/i,
  /\bcod\b/i,
  /cash.?on.?delivery/i,
  /payment.?on.?delivery/i,
  /zahlung.?bei.?zustellung/i,
];

const PREMIUM_PATTERN = /premium/i;

function shippingMethodHaystack(
  method: OrderShippingMethod | null | undefined,
): string {
  if (!method) return "";
  return `${method.title} ${method.code ?? ""}`.trim();
}

/** True when the Shopify shipping method indicates Cash on Delivery. */
export function isCodShippingMethod(
  method: OrderShippingMethod | null | undefined,
): boolean {
  const haystack = shippingMethodHaystack(method);
  if (!haystack) return false;
  return COD_PATTERNS.some((p) => p.test(haystack));
}

/** True when the Shopify shipping method indicates DHL Premium. */
export function isPremiumShippingMethod(
  method: OrderShippingMethod | null | undefined,
): boolean {
  const haystack = shippingMethodHaystack(method);
  if (!haystack) return false;
  return PREMIUM_PATTERN.test(haystack);
}

export function summarizeDhlServices(
  order: Pick<
    Order,
    "shipping_method" | "cod_amount_cents" | "currency"
  >,
): DhlServicesSummary {
  const cod = isCodShippingMethod(order.shipping_method);
  const premium = isPremiumShippingMethod(order.shipping_method);
  return {
    cod,
    codAmountCents: cod ? order.cod_amount_cents : null,
    codCurrency: cod ? order.currency : null,
    premium,
    shippingMethodTitle: order.shipping_method?.title ?? null,
  };
}

/** Build the `services` block for a DHL shipment, or `undefined` if none apply. */
export function buildDhlServices(
  order: Pick<
    Order,
    "id" | "name" | "shipping_method" | "cod_amount_cents" | "currency"
  >,
  config: DhlConfig,
  /**
   * Optional manual override for the COD amount (in cents). When the order
   * doesn't carry `cod_amount_cents` (legacy sync), the warehouse staff can
   * enter the amount in the UI.
   */
  codAmountCentsOverride?: number | null,
): DhlVAS | undefined {
  const summary = summarizeDhlServices(order);
  const services: DhlVAS = {};

  if (summary.premium) {
    services.premium = true;
  }

  if (summary.cod) {
    const cents =
      codAmountCentsOverride != null && codAmountCentsOverride > 0
        ? codAmountCentsOverride
        : order.cod_amount_cents;
    if (cents == null || cents <= 0) {
      throw new DhlServicesError(
        "cod_missing_amount",
        "Versandmethode ist Nachnahme, aber kein offener Betrag hinterlegt.",
      );
    }
    const currency = (order.currency ?? "EUR").toUpperCase();
    if (currency !== "EUR") {
      throw new DhlServicesError(
        "cod_currency_not_eur",
        `Nachnahme nur in EUR möglich, Order-Währung ist ${currency}.`,
      );
    }
    if (!config.cod_account_reference) {
      throw new DhlServicesError(
        "cod_missing_account_reference",
        "Nachnahme-Kontoreferenz fehlt in der DHL-Konfiguration.",
      );
    }
    services.cashOnDelivery = {
      amount: { currency: "EUR", value: cents / 100 },
      accountReference: config.cod_account_reference,
      transferNote1: order.name.slice(0, 35),
    };
  }

  return Object.keys(services).length > 0 ? services : undefined;
}
