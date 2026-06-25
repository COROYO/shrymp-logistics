import { describe, expect, it } from "vitest";
import { numericIdFromGid } from "./sync";

describe("numericIdFromGid", () => {
  it("extracts numeric tail from a GID", () => {
    expect(numericIdFromGid("gid://shopify/Product/12345")).toBe("12345");
    expect(numericIdFromGid("gid://shopify/ProductVariant/9876543210")).toBe(
      "9876543210",
    );
  });

  it("returns input unchanged if no slash present", () => {
    expect(numericIdFromGid("12345")).toBe("12345");
  });
});
