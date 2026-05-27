import { describe, expect, it } from "vitest";
import {
  AddressMappingError,
  buildShipmentOrderRequest,
  consigneeFromShopify,
  iso2ToIso3,
  pickDhlProduct,
  refNoForOrder,
  splitStreetHouse,
} from "./request-builder";
import type { DhlConfig, Order, ShippingAddress } from "@/server/firestore/schema";

const baseShipper: DhlConfig["shipper"] = {
  name1: "Ikrinka GmbH",
  name2: null,
  addressStreet: "Lagerstraße",
  addressHouse: "1",
  postalCode: "10115",
  city: "Berlin",
  country: "DEU",
  email: "versand@ikrinka.de",
  phone: null,
};

const baseConfig: DhlConfig = {
  billing_number: "33333333330102",
  profile: "STANDARD_GRUPPENPROFIL",
  shipper: baseShipper,
  default_weight_g: 1000,
  gkp_username: "user",
  gkp_password: "pass",
  sandbox: true,
  updated_at: new Date(),
  updated_by_uid: null,
};

function shippingAddress(over: Partial<ShippingAddress> = {}): ShippingAddress {
  return {
    first_name: "Maria",
    last_name: "Musterfrau",
    company: null,
    address1: "Hauptstraße 17a",
    address2: null,
    zip: "53113",
    city: "Bonn",
    country: "Germany",
    country_code: "DE",
    phone: null,
    ...over,
  };
}

function order(
  over: Partial<Pick<Order, "id" | "name" | "shipping_address">> = {},
): Pick<Order, "id" | "name" | "shipping_address"> {
  return {
    id: "1234567890",
    name: "#1042",
    shipping_address: shippingAddress(),
    ...over,
  };
}

describe("iso2ToIso3", () => {
  it("maps known codes", () => {
    expect(iso2ToIso3("DE")).toBe("DEU");
    expect(iso2ToIso3("nl")).toBe("NLD");
    expect(iso2ToIso3("GB")).toBe("GBR");
  });
  it("returns null for unknown / empty", () => {
    expect(iso2ToIso3(null)).toBeNull();
    expect(iso2ToIso3("")).toBeNull();
    expect(iso2ToIso3("ZZ")).toBeNull();
  });
});

describe("pickDhlProduct", () => {
  it("uses V01PAK for DE, V53WPAK elsewhere", () => {
    expect(pickDhlProduct("DEU")).toBe("V01PAK");
    expect(pickDhlProduct("NLD")).toBe("V53WPAK");
    expect(pickDhlProduct("USA")).toBe("V53WPAK");
  });
});

describe("splitStreetHouse", () => {
  it("splits common patterns", () => {
    expect(splitStreetHouse("Hauptstraße 17a")).toEqual({
      street: "Hauptstraße",
      house: "17a",
    });
    expect(splitStreetHouse("Am Park 10")).toEqual({
      street: "Am Park",
      house: "10",
    });
    expect(splitStreetHouse("Kurt-Schumacher-Str. 20-22")).toEqual({
      street: "Kurt-Schumacher-Str.",
      house: "20-22",
    });
  });
  it("leaves everything in street if no trailing number", () => {
    expect(splitStreetHouse("Hauptstraße")).toEqual({
      street: "Hauptstraße",
    });
  });
});

describe("refNoForOrder", () => {
  it("uses cleaned order name + id", () => {
    expect(refNoForOrder("1234567890", "#1042")).toBe("1042-1234567890");
  });
  it("falls back when name is too short / empty", () => {
    expect(refNoForOrder("9", "")).toBe("ORDER-9");
  });
  it("caps length at 35", () => {
    const v = refNoForOrder("1234567890123456789012345678901234567890", "#1");
    expect(v.length).toBeLessThanOrEqual(35);
  });
});

describe("consigneeFromShopify", () => {
  it("maps a DE address", () => {
    const c = consigneeFromShopify(shippingAddress());
    expect(c.name1).toBe("Maria Musterfrau");
    expect(c.addressStreet).toBe("Hauptstraße");
    expect(c.addressHouse).toBe("17a");
    expect(c.country).toBe("DEU");
    expect(c.postalCode).toBe("53113");
    expect(c.city).toBe("Bonn");
  });
  it("prefers company in name1 when present", () => {
    const c = consigneeFromShopify(
      shippingAddress({ company: "Acme GmbH" }),
    );
    expect(c.name1).toBe("Acme GmbH");
    expect(c.name2).toBe("Maria Musterfrau");
  });
  it("throws on missing fields", () => {
    expect(() =>
      consigneeFromShopify(
        shippingAddress({ first_name: null, last_name: null, company: null }),
      ),
    ).toThrow(AddressMappingError);
    expect(() =>
      consigneeFromShopify(shippingAddress({ address1: null })),
    ).toThrow(AddressMappingError);
    expect(() =>
      consigneeFromShopify(shippingAddress({ country_code: "ZZ" })),
    ).toThrow(AddressMappingError);
  });
});

describe("buildShipmentOrderRequest", () => {
  it("builds a valid DE shipment", () => {
    const req = buildShipmentOrderRequest({
      order: order(),
      config: baseConfig,
    });
    expect(req.profile).toBe("STANDARD_GRUPPENPROFIL");
    expect(req.shipments).toHaveLength(1);
    const s = req.shipments[0]!;
    expect(s.product).toBe("V01PAK");
    expect(s.billingNumber).toBe("33333333330102");
    expect(s.refNo).toBe("1042-1234567890");
    expect(s.details.weight).toEqual({ uom: "g", value: 1000 });
    expect(s.shipper.name1).toBe("Ikrinka GmbH");
    expect(s.consignee.country).toBe("DEU");
  });

  it("picks V53WPAK for non-DE", () => {
    const req = buildShipmentOrderRequest({
      order: order({
        shipping_address: shippingAddress({
          country_code: "NL",
          country: "Netherlands",
          zip: "1071 AA",
          city: "Amsterdam",
          address1: "Museumstraat 1",
        }),
      }),
      config: baseConfig,
    });
    expect(req.shipments[0]!.product).toBe("V53WPAK");
  });

  it("overrides weight when explicit", () => {
    const req = buildShipmentOrderRequest({
      order: order(),
      config: baseConfig,
      weightG: 2500,
    });
    expect(req.shipments[0]!.details.weight.value).toBe(2500);
  });

  it("includes dimensions when configured", () => {
    const req = buildShipmentOrderRequest({
      order: order(),
      config: {
        ...baseConfig,
        default_dimensions_mm: { length: 200, width: 150, height: 100 },
      },
    });
    expect(req.shipments[0]!.details.dim).toEqual({
      uom: "mm",
      length: 200,
      width: 150,
      height: 100,
    });
  });

  it("throws when no shipping address", () => {
    expect(() =>
      buildShipmentOrderRequest({
        order: { id: "1", name: "#1", shipping_address: null },
        config: baseConfig,
      }),
    ).toThrow(AddressMappingError);
  });
});
