import { describe, expect, it } from "vitest";
import { centsToMoneyInput, parseMoneyInputToCents } from "./money-input";

describe("money-input", () => {
  it("parses German decimal format to cents", () => {
    expect(parseMoneyInputToCents("49,90")).toBe(4990);
    expect(parseMoneyInputToCents("12.34")).toBe(1234);
    expect(parseMoneyInputToCents("5")).toBe(500);
  });

  it("formats cents for input display", () => {
    expect(centsToMoneyInput(4990)).toBe("49,90");
    expect(centsToMoneyInput(null)).toBe("");
  });
});
