import { describe, expect, it } from "vitest";
import {
  formatPriorityTagsInput,
  orderHasPriorityTag,
  parsePriorityTagsInput,
} from "./priority-tags";

describe("parsePriorityTagsInput", () => {
  it("splits on commas and newlines, trims, dedupes case-insensitively", () => {
    expect(parsePriorityTagsInput(" EXPRESS_DHL, PRIO\nexpress_dhl ,VIP ")).toEqual([
      "EXPRESS_DHL",
      "PRIO",
      "VIP",
    ]);
  });

  it("returns empty for blank input", () => {
    expect(parsePriorityTagsInput("  , \n")).toEqual([]);
  });
});

describe("orderHasPriorityTag", () => {
  it("matches exact tags only", () => {
    expect(orderHasPriorityTag(["PRIO", "vip"], ["PRIO"])).toBe(true);
    expect(orderHasPriorityTag(["prio"], ["PRIO"])).toBe(false);
    expect(orderHasPriorityTag(["EXPRESS_DHL"], [])).toBe(false);
  });
});

describe("formatPriorityTagsInput", () => {
  it("joins with comma+space", () => {
    expect(formatPriorityTagsInput(["EXPRESS_DHL", "PRIO"])).toBe(
      "EXPRESS_DHL, PRIO",
    );
  });
});
