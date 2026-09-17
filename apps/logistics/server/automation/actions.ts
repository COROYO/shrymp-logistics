import "server-only";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type AutomationAction,
  type Order,
  type OrderLineItem,
  type Variant,
} from "@/server/firestore/schema";

export type ActionResult = {
  type: string;
  ok: boolean;
  detail?: string;
};

export type ActionOptions = {
  shopId: string;
  orderId: string | null;
  ruleId: string;
  dryRun: boolean;
};

/**
 * Execute one automation action. Local-only — never touches Shopify.
 */
export async function executeAction(
  action: AutomationAction,
  opts: ActionOptions,
): Promise<ActionResult> {
  switch (action.type) {
    case "add_local_tag":
      return addLocalTag(action.tag, opts);
    case "remove_local_tag":
      return removeLocalTag(action.tag, opts);
    case "set_priority_score":
      return setPriorityScore(action.score, opts);
    case "add_free_gift":
      return addFreeGift(action.variant_id, action.qty ?? 1, opts);
    case "hold_order":
      return setHold(true, opts);
    case "release_hold":
      return setHold(false, opts);
    default: {
      const _exhaustive: never = action;
      return { type: String(_exhaustive), ok: false, detail: "unknown_action" };
    }
  }
}

async function requireOrder(
  opts: ActionOptions,
): Promise<{ ref: DocumentReference; order: Order } | null> {
  if (!opts.orderId) return null;
  const db = adminDb();
  const ref = db.collection(Collections.Orders).doc(opts.orderId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return { ref, order: snap.data() as Order };
}

async function addLocalTag(
  tag: string,
  opts: ActionOptions,
): Promise<ActionResult> {
  const type = "add_local_tag";
  if (opts.dryRun) {
    return { type, ok: true, detail: `dry_run:add:${tag}` };
  }
  const loaded = await requireOrder(opts);
  if (!loaded) return { type, ok: false, detail: "no_order" };
  const tags = loaded.order.local_tags ?? [];
  if (tags.includes(tag)) {
    return { type, ok: true, detail: "already_present" };
  }
  await loaded.ref.update({
    local_tags: [...tags, tag],
    updated_at: FieldValue.serverTimestamp(),
  });
  return { type, ok: true, detail: `added:${tag}` };
}

async function removeLocalTag(
  tag: string,
  opts: ActionOptions,
): Promise<ActionResult> {
  const type = "remove_local_tag";
  if (opts.dryRun) {
    return { type, ok: true, detail: `dry_run:remove:${tag}` };
  }
  const loaded = await requireOrder(opts);
  if (!loaded) return { type, ok: false, detail: "no_order" };
  const tags = loaded.order.local_tags ?? [];
  if (!tags.includes(tag)) {
    return { type, ok: true, detail: "not_present" };
  }
  await loaded.ref.update({
    local_tags: tags.filter((t) => t !== tag),
    updated_at: FieldValue.serverTimestamp(),
  });
  return { type, ok: true, detail: `removed:${tag}` };
}

async function setPriorityScore(
  score: number,
  opts: ActionOptions,
): Promise<ActionResult> {
  const type = "set_priority_score";
  const clamped = Math.max(0, Math.min(100, Math.trunc(score)));
  if (opts.dryRun) {
    return { type, ok: true, detail: `dry_run:score:${clamped}` };
  }
  const loaded = await requireOrder(opts);
  if (!loaded) return { type, ok: false, detail: "no_order" };
  await loaded.ref.update({
    priority_score: clamped,
    updated_at: FieldValue.serverTimestamp(),
  });
  return { type, ok: true, detail: `score:${clamped}` };
}

async function setHold(
  hold: boolean,
  opts: ActionOptions,
): Promise<ActionResult> {
  const type = hold ? "hold_order" : "release_hold";
  if (opts.dryRun) {
    return { type, ok: true, detail: `dry_run:hold:${hold}` };
  }
  const loaded = await requireOrder(opts);
  if (!loaded) return { type, ok: false, detail: "no_order" };
  await loaded.ref.update({
    automation_hold: hold,
    updated_at: FieldValue.serverTimestamp(),
  });
  return { type, ok: true, detail: hold ? "held" : "released" };
}

async function addFreeGift(
  variantId: string,
  qty: number,
  opts: ActionOptions,
): Promise<ActionResult> {
  const type = "add_free_gift";
  const lineId = `auto:${opts.ruleId}:${variantId}`;
  if (opts.dryRun) {
    return { type, ok: true, detail: `dry_run:gift:${variantId}x${qty}` };
  }
  const loaded = await requireOrder(opts);
  if (!loaded) return { type, ok: false, detail: "no_order" };

  const existing = loaded.order.line_items ?? [];
  if (existing.some((li) => li.id === lineId)) {
    return { type, ok: true, detail: "already_added" };
  }

  const db = adminDb();
  const vSnap = await db.collection(Collections.Variants).doc(variantId).get();
  if (!vSnap.exists) {
    return { type, ok: false, detail: `unknown_variant:${variantId}` };
  }
  const v = vSnap.data() as Variant;
  if (v.shop_id && v.shop_id !== opts.shopId) {
    return { type, ok: false, detail: "variant_wrong_shop" };
  }

  const gift: OrderLineItem = {
    id: lineId,
    variant_id: variantId,
    variant_gid: v.shopify_gid,
    qty,
    title: v.title || "Gratisbeigabe",
    sku: v.sku ?? null,
    source: "automation",
    automation_rule_id: opts.ruleId,
    is_free_gift: true,
  };

  await loaded.ref.update({
    line_items: [...existing, gift],
    updated_at: FieldValue.serverTimestamp(),
  });
  return { type, ok: true, detail: `gift:${variantId}x${qty}` };
}
