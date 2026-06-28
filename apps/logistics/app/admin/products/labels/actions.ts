"use server";
import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import { runWithTenantAsync } from "@/server/tenant/context";
import {
  assignVariantSku,
  generateAndAssignSku,
  SkuError,
} from "@/server/warehouse/sku";
import { ShopifyGraphQLError } from "@/server/shopify/client";
import { log } from "@/lib/logger";

export type SkuResult = { ok: true; sku: string } | { ok: false; error: string };

async function ctx() {
  const user = await requireRole("ADMIN");
  const shopId = await requireActiveShopId(user);
  return { user, shopId };
}

function errMessage(e: unknown): string {
  if (e instanceof SkuError) return e.code;
  if (e instanceof ShopifyGraphQLError) return "shopify_failed";
  return e instanceof Error ? e.message : "unknown";
}

export async function assignSkuAction(
  variantId: string,
  sku: string,
): Promise<SkuResult> {
  try {
    const { shopId, user } = await ctx();
    const res = await runWithTenantAsync(shopId, () =>
      assignVariantSku(shopId, variantId, sku, user.uid),
    );
    return { ok: true, sku: res.sku };
  } catch (e) {
    log.warn("assign_sku_failed", { variantId, error: String(e) });
    return { ok: false, error: errMessage(e) };
  }
}

export async function generateSkuAction(variantId: string): Promise<SkuResult> {
  try {
    const { shopId, user } = await ctx();
    const res = await runWithTenantAsync(shopId, () =>
      generateAndAssignSku(shopId, variantId, user.uid),
    );
    return { ok: true, sku: res.sku };
  } catch (e) {
    log.warn("generate_sku_failed", { variantId, error: String(e) });
    return { ok: false, error: errMessage(e) };
  }
}
