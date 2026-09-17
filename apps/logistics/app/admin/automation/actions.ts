"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import {
  AutomationActionSchema,
  AutomationConditionNodeSchema,
  AutomationTriggerSchema,
  type AutomationAction,
  type AutomationConditionNode,
  type AutomationTrigger,
} from "@/server/firestore/schema";
import {
  deleteAutomationRule,
  setAutomationRuleEnabled,
  upsertAutomationRule,
} from "@/server/automation/rules-repo";
import { dispatchAutomationEvent } from "@/server/automation/dispatch";
import { loadVariantLabels } from "@/server/warehouse/product-labels";

export type ActionResult =
  | { ok: true; id?: string; detail?: string }
  | { ok: false; error: string };

export type GiftVariantOption = {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
};

export async function listGiftVariantsAction(): Promise<
  | { ok: true; variants: GiftVariantOption[] }
  | { ok: false; error: string }
> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    const shopId = await requireActiveShopId(user);
    const rows = await loadVariantLabels(shopId);
    return {
      ok: true,
      variants: rows.map((r) => ({
        variantId: r.variantId,
        productTitle: r.productTitle,
        variantTitle: r.variantTitle,
        sku: r.sku,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const SaveSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  enabled: z.boolean(),
  trigger: AutomationTriggerSchema,
  priority: z.number().int(),
  stop_on_match: z.boolean(),
  conditions: AutomationConditionNodeSchema.optional(),
  actions: z.array(AutomationActionSchema).min(1).max(20),
});

export async function saveRuleAction(raw: unknown): Promise<ActionResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    const shopId = await requireActiveShopId(user);
    const parsed = SaveSchema.parse(raw);
    const rule = await upsertAutomationRule({
      shopId,
      id: parsed.id,
      name: parsed.name,
      enabled: parsed.enabled,
      trigger: parsed.trigger as AutomationTrigger,
      conditions: parsed.conditions as AutomationConditionNode | undefined,
      actions: parsed.actions as AutomationAction[],
      priority: parsed.priority,
      stop_on_match: parsed.stop_on_match,
      uid: user.uid,
    });
    revalidatePath("/admin/automation");
    return { ok: true, id: rule.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteRuleAction(ruleId: string): Promise<ActionResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    const shopId = await requireActiveShopId(user);
    await deleteAutomationRule(shopId, ruleId);
    revalidatePath("/admin/automation");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function toggleRuleAction(
  ruleId: string,
  enabled: boolean,
): Promise<ActionResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    const shopId = await requireActiveShopId(user);
    await setAutomationRuleEnabled(shopId, ruleId, enabled, user.uid);
    revalidatePath("/admin/automation");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function runAutomationForOrder(
  orderId: string,
  trigger: AutomationTrigger,
  dryRun: boolean,
): Promise<ActionResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  try {
    const shopId = await requireActiveShopId(user);
    const result = await dispatchAutomationEvent({
      shopId,
      trigger,
      orderId,
      dryRun,
    });
    return {
      ok: true,
      detail: JSON.stringify(
        {
          dry_run: dryRun,
          matched: result?.matchedRuleIds ?? [],
          results: result?.results ?? [],
          runId: result?.runId ?? null,
        },
        null,
        2,
      ),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function dryRunRuleAction(
  orderId: string,
  trigger: AutomationTrigger,
): Promise<ActionResult> {
  return runAutomationForOrder(orderId, trigger, true);
}

/** Apply matching rules for real (tags / gifts / hold). */
export async function runRuleAction(
  orderId: string,
  trigger: AutomationTrigger,
): Promise<ActionResult> {
  const res = await runAutomationForOrder(orderId, trigger, false);
  if (res.ok) {
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${orderId}`);
  }
  return res;
}
