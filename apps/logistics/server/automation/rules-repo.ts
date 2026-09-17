import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  AutomationRuleSchema,
  AutomationConditionNodeSchema,
  type AutomationAction,
  type AutomationConditionNode,
  type AutomationRule,
  type AutomationTrigger,
} from "@/server/firestore/schema";

export async function listAutomationRules(
  shopId: string,
): Promise<AutomationRule[]> {
  const snap = await adminDb()
    .collection(Collections.AutomationRules)
    .where("shop_id", "==", shopId)
    .get();
  return snap.docs
    .map((d) => d.data() as AutomationRule)
    .sort(
      (a, b) =>
        (a.priority ?? 100) - (b.priority ?? 100) || a.id.localeCompare(b.id),
    );
}

export type UpsertAutomationRuleInput = {
  shopId: string;
  id?: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions?: AutomationConditionNode;
  actions: AutomationAction[];
  priority: number;
  stop_on_match: boolean;
  uid: string | null;
};

export async function upsertAutomationRule(
  input: UpsertAutomationRuleInput,
): Promise<AutomationRule> {
  const db = adminDb();
  const ref = input.id
    ? db.collection(Collections.AutomationRules).doc(input.id)
    : db.collection(Collections.AutomationRules).doc();

  const existing = input.id ? await ref.get() : null;
  const now = FieldValue.serverTimestamp();

  const draft = {
    id: ref.id,
    shop_id: input.shopId,
    name: input.name,
    enabled: input.enabled,
    trigger: input.trigger,
    actions: input.actions,
    priority: input.priority,
    stop_on_match: input.stop_on_match,
    created_at: existing?.exists
      ? (existing.data() as AutomationRule).created_at
      : now,
    updated_at: now,
    updated_by_uid: input.uid,
    ...(input.conditions ? { conditions: input.conditions } : {}),
  };

  // Shape-check actions/conditions (timestamps are FieldValue on write).
  AutomationRuleSchema.pick({
    name: true,
    enabled: true,
    trigger: true,
    actions: true,
    priority: true,
    stop_on_match: true,
  }).parse({
    name: draft.name,
    enabled: draft.enabled,
    trigger: draft.trigger,
    actions: draft.actions,
    priority: draft.priority,
    stop_on_match: draft.stop_on_match,
  });
  if (input.conditions) {
    AutomationConditionNodeSchema.parse(input.conditions);
  }

  // Full document replace — merge:true deep-merges nested `conditions` and
  // leaves stale leaf fields beside a new `all` array.
  await ref.set(draft);
  const snap = await ref.get();
  return snap.data() as AutomationRule;
}

export async function deleteAutomationRule(
  shopId: string,
  ruleId: string,
): Promise<void> {
  const ref = adminDb().collection(Collections.AutomationRules).doc(ruleId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const data = snap.data() as AutomationRule;
  if (data.shop_id !== shopId) {
    throw new Error("rule_wrong_shop");
  }
  await ref.delete();
}

export async function setAutomationRuleEnabled(
  shopId: string,
  ruleId: string,
  enabled: boolean,
  uid: string | null,
): Promise<void> {
  const ref = adminDb().collection(Collections.AutomationRules).doc(ruleId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("rule_not_found");
  const data = snap.data() as AutomationRule;
  if (data.shop_id !== shopId) throw new Error("rule_wrong_shop");
  await ref.update({
    enabled,
    updated_at: FieldValue.serverTimestamp(),
    updated_by_uid: uid,
  });
}
