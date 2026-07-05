import { describe, expect, it } from "vitest";
import { isOrderUnpaid } from "./financial-status";

describe("isOrderUnpaid", () => {
  it("treats pending/authorized/partially_paid/expired as unpaid", () => {
    for (const s of [
      "PENDING",
      "pending",
      "AUTHORIZED",
      "authorized",
      "PARTIALLY_PAID",
      "partially_paid",
      "EXPIRED",
      "expired",
    ]) {
      expect(isOrderUnpaid(s)).toBe(true);
    }
  });

  it("treats paid/refunded/voided as not unpaid", () => {
    for (const s of ["PAID", "paid", "REFUNDED", "VOIDED", "PARTIALLY_REFUNDED"]) {
      expect(isOrderUnpaid(s)).toBe(false);
    }
  });

  it("returns false for null/empty", () => {
    expect(isOrderUnpaid(null)).toBe(false);
    expect(isOrderUnpaid("")).toBe(false);
  });
});
