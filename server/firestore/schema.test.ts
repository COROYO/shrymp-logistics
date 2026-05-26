import { describe, expect, it } from "vitest";
import {
  BatchSchema,
  Collections,
  OrderSchema,
  ProductSchema,
  UserSchema,
  VariantSchema,
} from "./schema";

describe("Firestore Zod schemas", () => {
  it("ProductSchema accepts a minimal valid product", () => {
    const result = ProductSchema.parse({
      id: "p_1",
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

  it("Collections constant names match strings used elsewhere", () => {
    expect(Collections.Orders).toBe("orders");
    expect(Collections.Batches).toBe("batches");
    expect(Collections.Allocations).toBe("allocations");
  });
});
