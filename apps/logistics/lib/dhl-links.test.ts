import { describe, expect, it } from "vitest";
import { buildDhlLinks } from "./dhl-links";

describe("buildDhlLinks", () => {
  it("renders standard URL with shop handle + order id", () => {
    const { standard } = buildDhlLinks(
      "12344759517528",
      "monolithcaviar.myshopify.com",
    );
    expect(standard).toBe(
      "https://admin.shopify.com/store/monolithcaviar/apps/easydhl/fulfillments/create?id=12344759517528&shop=monolithcaviar.myshopify.com",
    );
  });

  it("renders express URL", () => {
    const { express } = buildDhlLinks(
      "12343073014104",
      "monolithcaviar.myshopify.com",
    );
    expect(express).toBe(
      "https://dhlexpresscommerce.com/templates/admin4/quickprint.aspx?id=12343073014104&shop=monolithcaviar.myshopify.com",
    );
  });

  it("URL-encodes order id", () => {
    const { standard } = buildDhlLinks("foo bar", "x.myshopify.com");
    expect(standard).toContain("id=foo%20bar");
  });

  it("falls back to full domain when not a standard *.myshopify.com", () => {
    const { standard } = buildDhlLinks("1", "custom-domain.example.com");
    expect(standard).toContain("/store/custom-domain.example.com/");
  });
});
