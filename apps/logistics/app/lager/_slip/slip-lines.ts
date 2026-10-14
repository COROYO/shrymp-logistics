/**
 * Pure grouping math for packing-slip line items, split out from the render
 * component so it can be unit-tested without React.
 *
 * Two jobs:
 *   1. Group line items that belong to the same Shopify bundle
 *      (`li.bundle.group_id`) under a heading carrying the bundle parent's
 *      title — otherwise a picker can't tell that e.g. three tins are one
 *      gift box and not loose articles.
 *   2. Collapse duplicate positions *within the same context* (same title AND
 *      sku) into one row with summed quantity and merged Charge allocations.
 *
 * The collapse is scoped per section: a product that appears BOTH as a bundle
 * component AND as a standalone article stays on separate rows, so the picker
 * packs the right count into the box and the rest loose.
 */

import type { OrderLineItem } from "@/server/firestore/schema";
import type { SlipAllocLine } from "@/server/picking/slip-data";

export type MergedSlipLine = {
  key: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  binCode: string | null;
  qty: number;
  allocs: { chargeNumber: string; qty: number }[];
};

/** Shopify bundle parent (LineItemGroup) rendered as a heading above its components. */
export type SlipBundleHeader = {
  title: string;
  sku: string | null;
  quantity: number;
};

export type SlipSection = {
  key: string;
  /** Non-null when `lines` are the components of a Shopify bundle. */
  bundle: SlipBundleHeader | null;
  lines: MergedSlipLine[];
};

/** All non-bundle line items share this one section (rendered without a heading). */
const STANDALONE_KEY = "__standalone__";

export function buildSlipSections(
  lineItems: OrderLineItem[],
  allocsByLi: Map<string, SlipAllocLine[]>,
  variantTitleByLi: Map<string, string | null>,
  binByVariant: Map<string, string | null>,
): SlipSection[] {
  type SectionAcc = {
    key: string;
    bundle: SlipBundleHeader | null;
    lineOrder: string[];
    lines: Map<string, MergedSlipLine>;
  };

  const sectionOrder: string[] = [];
  const sections = new Map<string, SectionAcc>();

  for (const li of lineItems) {
    const sectionKey = li.bundle ? `b:${li.bundle.group_id}` : STANDALONE_KEY;
    let section = sections.get(sectionKey);
    if (!section) {
      section = {
        key: sectionKey,
        bundle: li.bundle
          ? {
              title: li.bundle.title,
              sku: li.bundle.variant_sku,
              quantity: li.bundle.quantity,
            }
          : null,
        lineOrder: [],
        lines: new Map(),
      };
      sections.set(sectionKey, section);
      sectionOrder.push(sectionKey);
    }

    const lineKey = `${li.title}\u0001${li.sku ?? ""}`;
    let g = section.lines.get(lineKey);
    if (!g) {
      g = {
        key: `${sectionKey}|${lineKey}`,
        title: li.title,
        variantTitle: variantTitleByLi.get(li.id) ?? null,
        sku: li.sku ?? null,
        binCode: binByVariant.get(li.variant_id) ?? null,
        qty: 0,
        allocs: [],
      };
      section.lines.set(lineKey, g);
      section.lineOrder.push(lineKey);
    }
    g.qty += li.qty;
    for (const a of allocsByLi.get(li.id) ?? []) {
      g.allocs.push({ chargeNumber: a.chargeNumber, qty: a.qty });
    }
  }

  return sectionOrder.map((sk) => {
    const section = sections.get(sk)!;
    const lines = section.lineOrder.map((lk) => {
      const g = section.lines.get(lk)!;
      const byCharge = new Map<string, number>();
      for (const a of g.allocs) {
        byCharge.set(a.chargeNumber, (byCharge.get(a.chargeNumber) ?? 0) + a.qty);
      }
      g.allocs = [...byCharge.entries()]
        .map(([chargeNumber, qty]) => ({ chargeNumber, qty }))
        .sort((a, b) => a.chargeNumber.localeCompare(b.chargeNumber));
      return g;
    });
    return { key: section.key, bundle: section.bundle, lines };
  });
}
