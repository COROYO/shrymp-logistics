import { describe, expect, it } from "vitest";
import {
  eanCheckDigit,
  encodeEan,
  encodeParsedEan,
  parseEan,
} from "./ean";

describe("eanCheckDigit", () => {
  it("computes EAN-13 check digits", () => {
    expect(eanCheckDigit("400638133393")).toBe(1);
    expect(eanCheckDigit("590123412345")).toBe(7);
  });

  it("computes EAN-8 check digits", () => {
    expect(eanCheckDigit("9638507")).toBe(4);
  });
});

describe("parseEan", () => {
  it("accepts valid EAN-13", () => {
    expect(parseEan("4006381333931")).toEqual({
      kind: "ean13",
      digits: "4006381333931",
    });
  });

  it("accepts valid EAN-8", () => {
    expect(parseEan("96385074")).toEqual({
      kind: "ean8",
      digits: "96385074",
    });
  });

  it("trims whitespace", () => {
    expect(parseEan("  4006381333931  ")?.digits).toBe("4006381333931");
  });

  it("pads valid UPC-A to EAN-13", () => {
    // UPC-A 036000291452 → EAN-13 0036000291452
    expect(parseEan("036000291452")).toEqual({
      kind: "ean13",
      digits: "0036000291452",
    });
  });

  it("rejects bad check digits and non-numeric input", () => {
    expect(parseEan("4006381333930")).toBeNull();
    expect(parseEan("96385075")).toBeNull();
    expect(parseEan("ABC")).toBeNull();
    expect(parseEan("12345")).toBeNull();
    expect(parseEan("")).toBeNull();
  });
});

describe("encodeEan", () => {
  it("encodes EAN-13 with expected module width", () => {
    // quiet(11)*2 + guards(3+5+3) + 12*7 digits = 22 + 11 + 84 = 117
    const geo = encodeEan("4006381333931");
    expect(geo.kind).toBe("ean13");
    expect(geo.value).toBe("4006381333931");
    expect(geo.modules).toBe(117);
    expect(geo.bars.length).toBeGreaterThan(0);
    // Bars must stay inside the drawable region (excluding trailing quiet).
    for (const b of geo.bars) {
      expect(b.x).toBeGreaterThanOrEqual(11);
      expect(b.x + b.width).toBeLessThanOrEqual(geo.modules - 11);
      expect(b.width).toBeGreaterThan(0);
    }
  });

  it("encodes EAN-8 with expected module width", () => {
    // quiet(11)*2 + guards(3+5+3) + 8*7 = 22 + 11 + 56 = 89
    const geo = encodeEan("96385074");
    expect(geo.kind).toBe("ean8");
    expect(geo.modules).toBe(89);
  });

  it("encodeParsedEan matches encodeEan", () => {
    const parsed = parseEan("5901234123457")!;
    expect(encodeParsedEan(parsed)).toEqual(encodeEan(parsed.digits));
  });

  it("throws on invalid input", () => {
    expect(() => encodeEan("nope")).toThrow(/invalid_ean/);
  });
});
