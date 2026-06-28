import { describe, expect, it } from "vitest";
import {
  buildDhlServices,
  DhlServicesError,
  isCodShippingMethod,
  isPremiumShippingMethod,
  summarizeDhlServices,
} from "./services";
import type { DhlConfig, Order, OrderShippingMethod } from "@/server/firestore/schema";

const baseConfig: DhlConfig = {
  billing_number: "33333333330102",
  profile: "STANDARD_GRUPPENPROFIL",
  shipper: {
    name1: "Test",
    name2: null,
    addressStreet: "Str",
    addressHouse: null,
    postalCode: "10115",
    city: "Berlin",
    country: "DEU",
    email: null,
    phone: null,
  },
  default_weight_g: 1000,
  gkp_username: "u",
  gkp_password: "p",
  api_key: "test-api-key",
  api_secret: "test-api-secret",
  cod_account_reference: "REF-1",
  sandbox: true,
  updated_at: new Date(),
  updated_by_uid: null,
};

function shippingMethod(
  over: Partial<OrderShippingMethod> = {},
): OrderShippingMethod {
  return { title: "DHL Paket", code: null, ...over };
}

function order(
  over: Partial<
    Pick<Order, "id" | "name" | "shipping_method" | "cod_amount_cents" | "currency">
  > = {},
): Pick<
  Order,
  "id" | "name" | "shipping_method" | "cod_amount_cents" | "currency"
> {
  return {
    id: "1",
    name: "#1001",
    shipping_method: shippingMethod(),
    cod_amount_cents: null,
    currency: "EUR",
    ...over,
  };
}

describe("isCodShippingMethod", () => {
  it("detects Nachnahme in title", () => {
    expect(
      isCodShippingMethod(shippingMethod({ title: "DHL Paket Nachnahme" })),
    ).toBe(true);
  });

  it("detects COD in code", () => {
    expect(
      isCodShippingMethod(shippingMethod({ title: "Standard", code: "COD" })),
    ).toBe(true);
  });

  it("returns false for standard shipping", () => {
    expect(isCodShippingMethod(shippingMethod({ title: "DHL Paket" }))).toBe(
      false,
    );
    expect(isCodShippingMethod(null)).toBe(false);
  });
});

describe("isPremiumShippingMethod", () => {
  it("detects premium in title", () => {
    expect(
      isPremiumShippingMethod(shippingMethod({ title: "DHL Paket Premium" })),
    ).toBe(true);
  });
});

describe("summarizeDhlServices", () => {
  it("detects COD and premium from shipping method", () => {
    expect(
      summarizeDhlServices(
        order({
          shipping_method: shippingMethod({
            title: "DHL Nachnahme Premium",
          }),
          cod_amount_cents: 500,
        }),
      ),
    ).toEqual({
      cod: true,
      codAmountCents: 500,
      codCurrency: "EUR",
      premium: true,
      shippingMethodTitle: "DHL Nachnahme Premium",
    });
  });
});

describe("buildDhlServices", () => {
  it("throws when COD shipping method but no amount", () => {
    expect(() =>
      buildDhlServices(
        order({
          shipping_method: shippingMethod({ title: "Nachnahme" }),
        }),
        baseConfig,
      ),
    ).toThrow(DhlServicesError);
  });

  it("throws when COD but no account reference", () => {
    expect(() =>
      buildDhlServices(
        order({
          shipping_method: shippingMethod({ title: "Nachnahme" }),
          cod_amount_cents: 100,
        }),
        { ...baseConfig, cod_account_reference: null },
      ),
    ).toThrow(DhlServicesError);
  });
});
