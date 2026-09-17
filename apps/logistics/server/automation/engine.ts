import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  type AutomationRule,
  type AutomationTrigger,
} from "@/server/firestore/schema";
import { buildEvalContext, type BuildContextInput } from "./context";
import { evaluateConditions } from "./conditions";
import { executeAction, type ActionResult } from "./actions";
import { log } from "@/lib/logger";

const MAX_DEPTH = 3;

export type EngineOptions = {
  shopId: string;
  trigger: AutomationTrigger;
  orderId?: string | null;
  variantId?: string | null;
  inboundQty?: number | null;
  dryRun?: boolean;
  /** Prevent recursive trigger loops. */
  depth?: number;
};

export type RuleEvalResult = {
  rule_id: string;
  matched: boolean;
  actions: ActionResult[];
  error?: string;
};

export type EngineResult = {
  matchedRuleIds: string[];
  results: RuleEvalResult[];
  runId: string | null;
};

/**
 * Evaluate enabled rules for a trigger. Best-effort side effects;
 * callers should catch and never fail the core lifecycle on automation errors.
 */
export async function runAutomationEngine(
  opts: EngineOptions,
): Promise<EngineResult> {
  const depth = opts.depth ?? 0;
  if (depth >= MAX_DEPTH) {
    log.warn("automation_depth_exceeded", {
      shopId: opts.shopId,
      trigger: opts.trigger,
      depth,
    });
    return { matchedRuleIds: [], results: [], runId: null };
  }

  const dryRun = opts.dryRun ?? false;
  const db = adminDb();

  const rulesSnap = await db
    .collection(Collections.AutomationRules)
    .where("shop_id", "==", opts.shopId)
    .where("trigger", "==", opts.trigger)
    .where("enabled", "==", true)
    .get();

  const rules = rulesSnap.docs
    .map((d) => d.data() as AutomationRule)
    .sort(
      (a, b) =>
        (a.priority ?? 100) - (b.priority ?? 100) || a.id.localeCompare(b.id),
    );

  if (rules.length === 0) {
    return { matchedRuleIds: [], results: [], runId: null };
  }

  let order = null;
  if (opts.orderId) {
    const oSnap = await db.collection(Collections.Orders).doc(opts.orderId).get();
    if (oSnap.exists) order = oSnap.data() as BuildContextInput["order"];
  }

  const ctx = await buildEvalContext({
    shopId: opts.shopId,
    order,
    excludeOrderId: opts.orderId,
    inbound:
      opts.variantId != null
        ? { variantId: opts.variantId, qty: opts.inboundQty ?? 0 }
        : null,
  });

  const results: RuleEvalResult[] = [];
  const matchedRuleIds: string[] = [];

  for (const rule of rules) {
    try {
      const matched = evaluateConditions(rule.conditions, ctx);
      if (!matched) {
        results.push({ rule_id: rule.id, matched: false, actions: [] });
        continue;
      }
      matchedRuleIds.push(rule.id);
      const actionResults: ActionResult[] = [];
      for (const action of rule.actions) {
        // Re-read order mid-chain so gifts/tags from earlier actions are visible
        // to later ones on the same rule; context for *conditions* stays frozen.
        const ar = await executeAction(action, {
          shopId: opts.shopId,
          orderId: opts.orderId ?? null,
          ruleId: rule.id,
          dryRun,
        });
        actionResults.push(ar);
      }
      results.push({
        rule_id: rule.id,
        matched: true,
        actions: actionResults,
      });
      if (rule.stop_on_match) break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn("automation_rule_failed", {
        ruleId: rule.id,
        trigger: opts.trigger,
        error: msg,
      });
      results.push({
        rule_id: rule.id,
        matched: false,
        actions: [],
        error: msg,
      });
    }
  }

  let runId: string | null = null;
  if (!dryRun || matchedRuleIds.length > 0 || results.some((r) => r.error)) {
    const runRef = db.collection(Collections.AutomationRuns).doc();
    runId = runRef.id;
    const expires = new Date();
    expires.setDate(expires.getDate() + 90);
    await runRef.set({
      id: runRef.id,
      shop_id: opts.shopId,
      trigger: opts.trigger,
      order_id: opts.orderId ?? null,
      variant_id: opts.variantId ?? null,
      dry_run: dryRun,
      matched_rule_ids: matchedRuleIds,
      results,
      created_at: FieldValue.serverTimestamp(),
      expires_at: expires,
    });
  }

  log.info("automation_engine_done", {
    shopId: opts.shopId,
    trigger: opts.trigger,
    orderId: opts.orderId,
    matched: matchedRuleIds.length,
    dryRun,
    runId,
  });

  return { matchedRuleIds, results, runId };
}
