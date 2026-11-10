import { describe, expect, it } from "vitest";
import { extractOrderEditOrderId } from "./order-edit";

describe("extractOrderEditOrderId", () => {
  it("reads order_id from the order_edit wrapper", () => {
    expect(
      extractOrderEditOrderId({
        order_edit: {
          id: 40526381212,
          order_id: 3883511185564,
          line_items: { additions: [], removals: [] },
        },
      }),
    ).toBe(3883511185564);
  });

  it("accepts numeric order_id as string", () => {
    expect(
      extractOrderEditOrderId({ order_edit: { order_id: "12345" } }),
    ).toBe(12345);
  });

  it("returns null for a full order payload (no order_edit)", () => {
    expect(extractOrderEditOrderId({ id: 99, name: "#1001" })).toBeNull();
  });

  it("returns null for missing/invalid bodies", () => {
    expect(extractOrderEditOrderId(null)).toBeNull();
    expect(extractOrderEditOrderId({})).toBeNull();
    expect(extractOrderEditOrderId({ order_edit: {} })).toBeNull();
    expect(
      extractOrderEditOrderId({ order_edit: { order_id: "nope" } }),
    ).toBeNull();
  });
});
