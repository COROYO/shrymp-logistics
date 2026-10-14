import { describe, expect, it } from "vitest";
import { buildSlipSections } from "./slip-lines";
import type { SlipAllocLine } from "./types";
import type { OrderLineItem } from "@/server/firestore/schema";

function li(
  partial: Partial<OrderLineItem> & { id: string; title: string; qty: number },
): OrderLineItem {
  return {
    variant_id: `v-${partial.id}`,
    variant_gid: `gid://shopify/ProductVariant/${partial.id}`,
    sku: null,
    ...partial,
  };
}

function bundle(
  group_id: string,
  title: string,
  quantity = 1,
  variant_sku: string | null = null,
): OrderLineItem["bundle"] {
  return {
    group_id,
    product_id: null,
    variant_id: null,
    variant_sku,
    title,
    quantity,
  };
}

const noTitles = new Map<string, string | null>();
const noBins = new Map<string, string | null>();
const noAllocs = new Map<string, SlipAllocLine[]>();

describe("buildSlipSections", () => {
  it("keeps non-bundle orders in one heading-less section, merged by title+sku", () => {
    const items = [
      li({ id: "1", title: "Forellenkaviar", sku: "525", qty: 2 }),
      li({ id: "2", title: "Keta", sku: "524", qty: 1 }),
      li({ id: "3", title: "Forellenkaviar", sku: "525", qty: 1 }),
    ];
    const sections = buildSlipSections(items, noAllocs, noTitles, noBins);

    expect(sections).toHaveLength(1);
    expect(sections[0]!.bundle).toBeNull();
    expect(sections[0]!.lines.map((l) => [l.title, l.qty])).toEqual([
      ["Forellenkaviar", 3],
      ["Keta", 1],
    ]);
  });

  it("groups bundle components under a heading carrying the bundle title", () => {
    const items = [
      li({
        id: "1",
        title: "Lachskaviar Keta «Classic»",
        sku: "756",
        qty: 1,
        bundle: bundle("18850480472", "Geschenkbox Happy Red", 1, "574"),
      }),
      li({
        id: "2",
        title: "Lachskaviar Gorbuscha «Classic»",
        sku: "601",
        qty: 1,
        bundle: bundle("18850480472", "Geschenkbox Happy Red", 1, "574"),
      }),
    ];
    const sections = buildSlipSections(items, noAllocs, noTitles, noBins);

    expect(sections).toHaveLength(1);
    expect(sections[0]!.bundle).toEqual({
      title: "Geschenkbox Happy Red",
      sku: "574",
      quantity: 1,
    });
    expect(sections[0]!.lines).toHaveLength(2);
  });

  it("does not merge a product that appears both inside a bundle and standalone", () => {
    const items = [
      li({
        id: "1",
        title: "Lachskaviar Keta «Classic»",
        sku: "756",
        qty: 1,
        bundle: bundle("18850480472", "Geschenkbox Happy Red"),
      }),
      li({
        id: "2",
        title: "Lachskaviar Keta «Classic»",
        sku: "756",
        qty: 2,
      }),
    ];
    const sections = buildSlipSections(items, noAllocs, noTitles, noBins);

    expect(sections).toHaveLength(2);
    expect(sections[0]!.bundle?.title).toBe("Geschenkbox Happy Red");
    expect(sections[0]!.lines).toEqual([
      expect.objectContaining({ title: "Lachskaviar Keta «Classic»", qty: 1 }),
    ]);
    expect(sections[1]!.bundle).toBeNull();
    expect(sections[1]!.lines).toEqual([
      expect.objectContaining({ title: "Lachskaviar Keta «Classic»", qty: 2 }),
    ]);
  });

  it("separates two different bundles into their own sections, in first-appearance order", () => {
    const items = [
      li({
        id: "1",
        title: "A",
        qty: 1,
        bundle: bundle("g1", "Happy Red"),
      }),
      li({ id: "2", title: "Loose", qty: 1 }),
      li({ id: "3", title: "B", qty: 1, bundle: bundle("g2", "TRIO") }),
    ];
    const sections = buildSlipSections(items, noAllocs, noTitles, noBins);

    expect(sections.map((s) => s.bundle?.title ?? "(standalone)")).toEqual([
      "Happy Red",
      "(standalone)",
      "TRIO",
    ]);
  });

  it("merges allocations by charge within a line and sorts them", () => {
    const items = [li({ id: "1", title: "Keta", sku: "524", qty: 3 })];
    const allocs = new Map<string, SlipAllocLine[]>([
      [
        "1",
        [
          { lineItemId: "1", chargeNumber: "B2", expiryDateIso: null, qty: 1 },
          { lineItemId: "1", chargeNumber: "A1", expiryDateIso: null, qty: 1 },
          { lineItemId: "1", chargeNumber: "A1", expiryDateIso: null, qty: 1 },
        ],
      ],
    ]);
    const sections = buildSlipSections(items, allocs, noTitles, noBins);

    expect(sections[0]!.lines[0]!.allocs).toEqual([
      { chargeNumber: "A1", qty: 2 },
      { chargeNumber: "B2", qty: 1 },
    ]);
  });

  it("passes through a bundle quantity greater than one", () => {
    const items = [
      li({
        id: "1",
        title: "A",
        qty: 2,
        bundle: bundle("g1", "Doppel-Set", 2),
      }),
    ];
    const sections = buildSlipSections(items, noAllocs, noTitles, noBins);
    expect(sections[0]!.bundle?.quantity).toBe(2);
  });

  it("keeps the bin of the component variant, not the bundle parent", () => {
    const items = [
      li({
        id: "1",
        title: "Keta",
        variant_id: "v-keta",
        qty: 1,
        bundle: bundle("g1", "Happy Red"),
      }),
    ];
    const bins = new Map<string, string | null>([["v-keta", "A-12"]]);
    const sections = buildSlipSections(items, noAllocs, noTitles, bins);
    expect(sections[0]!.lines[0]!.binCode).toBe("A-12");
  });
});
