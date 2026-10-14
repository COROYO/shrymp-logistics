import { describe, expect, it } from "vitest";
import { SLIP_LAYOUT_FLAG_KEYS } from "@/lib/slip/defaults";
import {
  BatchSchema,
  Collections,
  OrderSchema,
  ProductSchema,
  ShopSchema,
  SlipBrandingSchema,
  UserSchema,
  VariantSchema,
} from "./schema";

const SHOP = "test.myshopify.com";

describe("Firestore Zod schemas", () => {
  it("ProductSchema accepts a minimal valid product", () => {
    const result = ProductSchema.parse({
      id: "p_1",
      shop_id: SHOP,
      shopify_gid: "gid://shopify/Product/1",
      title: "Black Cod",
      handle: "black-cod",
      synced_at: new Date(),
    });
    expect(result.status).toBe("ACTIVE");
  });

  it("VariantSchema defaults qty fields to 0", () => {
    const v = VariantSchema.parse({
      id: "v_1",
      shop_id: SHOP,
      product_id: "p_1",
      shopify_gid: "gid://shopify/ProductVariant/1",
      inventory_item_gid: "gid://shopify/InventoryItem/1",
      title: "200g",
      updated_at: new Date(),
    });
    expect(v.on_hand_total).toBe(0);
    expect(v.reserved_total).toBe(0);
    expect(v.available).toBe(0);
    expect(v.sku).toBe(null);
  });

  it("BatchSchema rejects negative remaining_qty", () => {
    expect(() =>
      BatchSchema.parse({
        id: "b_1",
        shop_id: SHOP,
        variant_id: "v_1",
        charge_number: "0001",
        expiry_date: new Date(),
        initial_qty: 5,
        remaining_qty: -1,
        received_at: new Date(),
        received_by_uid: "u_1",
      }),
    ).toThrow();
  });

  it("OrderSchema parses an EXPRESS_DHL tagged order", () => {
    const o = OrderSchema.parse({
      id: "1001",
      shop_id: SHOP,
      shopify_gid: "gid://shopify/Order/1001",
      name: "#1001",
      tags: ["EXPRESS_DHL"],
      line_items: [
        {
          id: "li_1",
          variant_id: "v_1",
          variant_gid: "gid://shopify/ProductVariant/1",
          qty: 4,
          title: "Black Cod 200g",
        },
      ],
      created_at_shopify: new Date(),
      updated_at: new Date(),
    });
    expect(o.tags).toContain("EXPRESS_DHL");
    expect(o.internal_status).toBe("NEW");
    expect(o.line_items[0]?.sku).toBe(null);
  });

  it("UserSchema enforces role enum", () => {
    expect(() =>
      UserSchema.parse({
        id: "u_1",
        email: "x@example.com",
        role: "ROOT",
        created_at: new Date(),
      }),
    ).toThrow();
    const u = UserSchema.parse({
      id: "u_1",
      email: "x@example.com",
      role: "ADMIN",
      created_at: new Date(),
    });
    expect(u.disabled).toBe(false);
  });

  it("legacy slip branding stays valid and keeps every block visible", () => {
    const legacy = {
      brand_name: "ACME",
      eyebrow: "Premium",
      company_line: "ACME GmbH",
      contact_email: "a@b.de",
      accent_color: "#F3ACC8",
      header_color: "#0f1b33",
      document_title: "Lieferschein",
      signature: "Danke",
      footer_legal: "ACME",
    };
    const branding = SlipBrandingSchema.parse(legacy);
    for (const key of SLIP_LAYOUT_FLAG_KEYS) {
      expect(branding[key]).toBe(true);
    }
    expect(SlipBrandingSchema.parse({ ...legacy, col_bin: false }).col_bin).toBe(
      false,
    );
    expect(
      SlipBrandingSchema.parse({
        ...legacy,
        company_line: "ACME GmbH\nMusterstraße 1\n51373 Leverkusen",
      }).company_line,
    ).toContain("Musterstraße 1");

    const shop = ShopSchema.parse({
      id: SHOP,
      shop_domain: SHOP,
      created_at: new Date(),
      updated_at: new Date(),
      slip_branding: legacy,
    });
    expect(shop.slip_branding?.show_address).toBe(true);
    expect(shop.slip_branding?.col_charge).toBe(true);
    expect(shop.slip_branding?.title_size_pt).toBe(11);
    expect(shop.slip_branding?.sku_size_pt).toBe(9);
  });

  it("Collections constant names match strings used elsewhere", () => {
    expect(Collections.Orders).toBe("orders");
    expect(Collections.Batches).toBe("batches");
    expect(Collections.Allocations).toBe("allocations");
  });
});
