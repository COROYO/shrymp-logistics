/**
 * Pure mapping from a Shopify order + DHL config to the
 * `ShipmentOrderRequest` payload expected by the DHL Parcel DE Shipping API.
 *
 * Kept side-effect-free for unit testing.
 */

import type {
  DhlAddress,
  DhlConfig,
  Order,
  ShippingAddress,
} from "@/server/firestore/schema";
import { buildDhlServices } from "./services";
import type {
  DhlContactAddress,
  DhlProduct,
  DhlShipment,
  DhlShipmentOrderRequest,
  DhlShipper,
} from "./types";

export { summarizeDhlServices, type DhlServicesSummary } from "./services";
export { DhlServicesError } from "./services";

/** ISO 3166-1 alpha-2 → alpha-3, only entries we expect. */
const ISO2_TO_ISO3: Record<string, string> = {
  DE: "DEU",
  AT: "AUT",
  CH: "CHE",
  NL: "NLD",
  BE: "BEL",
  FR: "FRA",
  IT: "ITA",
  ES: "ESP",
  PL: "POL",
  CZ: "CZE",
  DK: "DNK",
  SE: "SWE",
  GB: "GBR",
  US: "USA",
  LU: "LUX",
  PT: "PRT",
  IE: "IRL",
  FI: "FIN",
  NO: "NOR",
  HU: "HUN",
  SK: "SVK",
  SI: "SVN",
  HR: "HRV",
  RO: "ROU",
  BG: "BGR",
  GR: "GRC",
  EE: "EST",
  LV: "LVA",
  LT: "LTU",
  IS: "ISL",
};

export function iso2ToIso3(code: string | null | undefined): string | null {
  if (!code) return null;
  return ISO2_TO_ISO3[code.toUpperCase()] ?? null;
}

/** Decide the DHL product based on the consignee country (alpha-3). */
export function pickDhlProduct(consigneeCountryIso3: string): DhlProduct {
  return consigneeCountryIso3 === "DEU" ? "V01PAK" : "V53WPAK";
}

/**
 * Split a Shopify "address1" string like "Hauptstr. 17a" into the DHL fields
 * `addressStreet` ("Hauptstr.") and `addressHouse` ("17a") if a trailing
 * house number is detectable. Falls back to leaving everything in
 * `addressStreet` when the format is unclear.
 */
export function splitStreetHouse(
  address1: string,
): { street: string; house?: string } {
  const m = address1.trim().match(/^(.*?)\s+(\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?)$/);
  if (!m || !m[1]) return { street: address1.trim() };
  return { street: m[1].trim(), house: m[2] };
}

function shipperToDhl(s: DhlAddress): DhlShipper {
  return {
    name1: s.name1,
    name2: s.name2 ?? undefined,
    addressStreet: s.addressStreet,
    addressHouse: s.addressHouse ?? undefined,
    postalCode: s.postalCode,
    city: s.city,
    country: s.country,
    email: s.email ?? undefined,
  };
}

export class AddressMappingError extends Error {
  constructor(
    public readonly code:
      | "missing_shipping_address"
      | "missing_name"
      | "missing_street"
      | "missing_city"
      | "missing_postal_code"
      | "missing_country"
      | "unsupported_country",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "AddressMappingError";
  }
}

export function consigneeFromShopify(addr: ShippingAddress): DhlContactAddress {
  const fullName = [addr.first_name, addr.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!fullName && !addr.company) {
    throw new AddressMappingError("missing_name");
  }
  if (!addr.address1) throw new AddressMappingError("missing_street");
  if (!addr.city) throw new AddressMappingError("missing_city");
  if (!addr.zip) throw new AddressMappingError("missing_postal_code");
  if (!addr.country_code) throw new AddressMappingError("missing_country");
  const iso3 = iso2ToIso3(addr.country_code);
  if (!iso3) {
    throw new AddressMappingError(
      "unsupported_country",
      `country_code "${addr.country_code}" has no ISO-3 mapping`,
    );
  }

  // Combine first/last name (or company) into name1; second line carries the
  // alternative (company under person, person under company).
  const name1 = addr.company || fullName;
  const name2 = addr.company && fullName ? fullName : undefined;

  const { street, house } = splitStreetHouse(addr.address1);
  const consignee: DhlContactAddress = {
    name1,
    name2,
    addressStreet: street,
    addressHouse: house,
    postalCode: addr.zip,
    city: addr.city,
    country: iso3,
    email: undefined,
    phone: addr.phone ?? undefined,
  };
  if (addr.address2) consignee.additionalAddressInformation1 = addr.address2;
  return consignee;
}

export type BuildShipmentInput = {
  order: Pick<
    Order,
    | "id"
    | "name"
    | "shipping_method"
    | "cod_amount_cents"
    | "currency"
    | "shipping_address"
  >;
  config: DhlConfig;
  weightG?: number;
  /** Manual override (in cents) for COD orders without `cod_amount_cents`. */
  codAmountCents?: number | null;
};

export function buildShipmentOrderRequest(
  input: BuildShipmentInput,
): DhlShipmentOrderRequest {
  const { order, config } = input;
  if (!order.shipping_address) {
    throw new AddressMappingError("missing_shipping_address");
  }
  const consignee = consigneeFromShopify(order.shipping_address);
  const product = pickDhlProduct(consignee.country);
  const weightG = input.weightG ?? config.default_weight_g;

  const shipment: DhlShipment = {
    product,
    billingNumber: config.billing_number,
    refNo: refNoForOrder(order.id, order.name),
    shipper: shipperToDhl(config.shipper),
    consignee,
    details: {
      weight: { uom: "g", value: weightG },
    },
  };
  if (config.default_dimensions_mm) {
    shipment.details.dim = {
      uom: "mm",
      length: config.default_dimensions_mm.length,
      width: config.default_dimensions_mm.width,
      height: config.default_dimensions_mm.height,
    };
  }

  const services = buildDhlServices(order, config, input.codAmountCents);
  if (services) shipment.services = services;

  return {
    profile: config.profile,
    shipments: [shipment],
  };
}

/**
 * Build a DHL `refNo` (Sendungsreferenz) from the Shopify order id and name.
 * Must be 8..35 chars to be searchable in DHL backend.
 */
export function refNoForOrder(orderId: string, orderName: string): string {
  const cleaned = orderName.replace(/[^A-Za-z0-9-]/g, "");
  const candidate = cleaned ? `${cleaned}-${orderId}` : `ORDER-${orderId}`;
  if (candidate.length >= 8) return candidate.slice(0, 35);
  return `ORDER-${orderId}`.slice(0, 35);
}
