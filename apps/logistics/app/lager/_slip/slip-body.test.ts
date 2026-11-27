import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveSlipBranding } from "@/lib/slip/defaults";
import type { SlipViewData } from "./types";
import { SlipBody } from "./slip-body";

function view(printPickList: boolean): SlipViewData {
  return {
    orderId: "o1",
    orderName: "#1001",
    createdAtIso: "2026-01-02T00:00:00.000Z",
    customerShopifyId: "42",
    shippingAddress: {
      first_name: "Ada",
      last_name: "Lovelace",
      company: null,
      address1: "Straße 1",
      address2: null,
      zip: "51373",
      city: "Leverkusen",
      country: "DE",
      country_code: "DE",
      phone: null,
    },
    lineItems: [
      {
        id: "li1",
        variant_id: "v1",
        variant_gid: null,
        qty: 2,
        title: "Dose",
        sku: "SKU-1",
      },
    ],
    allocsByLi: {},
    variantTitleByLi: {},
    binByVariant: { v1: "A-01" },
    imageByVariant: {},
    orderNote: "Bitte klingeln",
    lieferschein: { number: "LS-9", dateIso: "2026-01-03T00:00:00.000Z" },
    branding: resolveSlipBranding({
      print_pick_list: printPickList,
      show_order_note: true,
    }),
    batchesEnabled: false,
    qrDataUrl: null,
  };
}

function articles(html: string): string[] {
  return html.split('data-slip-article').slice(1);
}

describe("SlipBody pick list", () => {
  it("prints only the delivery note when the setting is off", () => {
    const html = renderToStaticMarkup(createElement(SlipBody, { data: view(false) }));
    expect(articles(html)).toHaveLength(1);
    expect(html).not.toContain("Pickliste");
    expect(html).toContain("Lieferadresse");
    expect(html).toContain("Bitte klingeln");
    expect(html).toContain("Seite(n)");
  });

  it("adds a pick list on its own page: header, customer no, lines, checkbox, no footer", () => {
    const html = renderToStaticMarkup(createElement(SlipBody, { data: view(true) }));
    const pages = articles(html);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("page-break-after:always");
    expect(pages[0]).toContain("Lieferadresse");
    expect(pages[0]).toContain("Seite(n)");

    const pick = pages[1]!;
    expect(pick).toContain("Pickliste");
    expect(pick).toContain("Kd.-Nr.");
    expect(pick).toContain("42");
    expect(pick).toContain("Dose");
    expect(pick).toContain("A-01");
    expect(pick).toContain("border-2");
    expect(pick).not.toContain("Lieferadresse");
    expect(pick).not.toContain("Bitte klingeln");
    expect(pick).not.toContain("Seite(n)");
    expect(pick).not.toContain("page-break-after");
  });
});
