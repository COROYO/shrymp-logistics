import "server-only";
import type { AutomationTrigger } from "@/server/firestore/schema";
import { runAutomationEngine, type EngineResult } from "./engine";
import { log } from "@/lib/logger";

export type DispatchAutomationEventInput = {
  shopId: string;
  trigger: AutomationTrigger;
  orderId?: string | null;
  variantId?: string | null;
  inboundQty?: number | null;
  dryRun?: boolean;
};

/**
 * Best-effort automation dispatch. Never throws to the caller —
 * failures are logged only so core warehouse flows stay intact.
 */
export async function dispatchAutomationEvent(
  input: DispatchAutomationEventInput,
): Promise<EngineResult | null> {
  try {
    return await runAutomationEngine({
      shopId: input.shopId,
      trigger: input.trigger,
      orderId: input.orderId,
      variantId: input.variantId,
      inboundQty: input.inboundQty,
      dryRun: input.dryRun,
    });
  } catch (e) {
    log.warn("automation_dispatch_failed", {
      shopId: input.shopId,
      trigger: input.trigger,
      orderId: input.orderId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
