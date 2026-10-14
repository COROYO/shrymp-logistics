import { describe, expect, it } from "vitest";
import { resolveSlipBranding, SLIP_LAYOUT_FLAG_KEYS } from "./defaults";

describe("resolveSlipBranding", () => {
  it("keeps a saved multiline address and an explicit hidden column", () => {
    const branding = resolveSlipBranding({
      company_line: "ACME GmbH\nMusterstraße 1\n51373 Leverkusen",
      col_bin: false,
      show_email: false,
    });
    expect(branding.company_line).toBe(
      "ACME GmbH\nMusterstraße 1\n51373 Leverkusen",
    );
    expect(branding.col_bin).toBe(false);
    expect(branding.show_email).toBe(false);
    expect(branding.show_address).toBe(true);
    expect(branding.col_qty).toBe(true);
    expect(branding.title_size_pt).toBe(11);
    expect(branding.sku_size_pt).toBe(9);
  });

  it("keeps a saved title and Art.-Nr. size inside the allowed range", () => {
    const branding = resolveSlipBranding({
      title_size_pt: 8,
      sku_size_pt: 7,
    });
    expect(branding.title_size_pt).toBe(8);
    expect(branding.sku_size_pt).toBe(7);
    expect(resolveSlipBranding({ title_size_pt: 40 }).title_size_pt).toBe(11);
  });

  it("fills every layout flag when the shop has no branding yet", () => {
    const branding = resolveSlipBranding(null);
    for (const key of SLIP_LAYOUT_FLAG_KEYS) {
      expect(branding[key]).toBe(true);
    }
  });
});
