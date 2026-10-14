import "server-only";
import { cache } from "react";
import { FieldValue } from "firebase-admin/firestore";
import { getShop } from "@/server/tenant/shop";
import { adminDb } from "@/server/firestore/admin";
import { Collections } from "@/server/firestore/schema";
import { normalizeShopId } from "@/server/tenant/id";
import type { SessionUser } from "@/lib/auth/session";
import { merchantNeedsShopifyConnect } from "@/lib/auth/merchant";
import { requireActiveShopId } from "@/lib/auth/tenant";
import { isSuperAdmin } from "@/lib/auth/super-admin";

export const ONBOARDING_STEP_COUNT = 7;

async function shopNeedsOnboardingUncached(shopId: string): Promise<boolean> {
  const shop = await getShop(normalizeShopId(shopId));
  if (!shop?.access_token || shop.status !== "ACTIVE") return false;
  return !shop.onboarding_completed_at;
}

export const shopNeedsOnboarding = cache(shopNeedsOnboardingUncached);

/** True when Shopify is connected but the first-run wizard is not finished. */
export async function merchantNeedsOnboarding(
  user: SessionUser,
): Promise<boolean> {
  if (user.role !== "ADMIN") return false;
  if (isSuperAdmin(user)) return false;
  if (await merchantNeedsShopifyConnect(user)) return false;
  const shopId = await requireActiveShopId(user);
  return shopNeedsOnboarding(shopId);
}

export async function getOnboardingStep(shopId: string): Promise<number> {
  const shop = await getShop(normalizeShopId(shopId));
  return shop?.onboarding_step ?? 0;
}

export type OnboardingImportState = {
  productsDone: boolean;
  productCount: number;
  variantCount: number;
  openOrdersDone: boolean;
  openOrdersCount: number;
  historyDone: boolean;
  historyOrdersCount: number;
};

export async function getOnboardingImport(
  shopId: string,
): Promise<OnboardingImportState> {
  const shop = await getShop(normalizeShopId(shopId));
  const imported = shop?.onboarding_import;
  return {
    productsDone: imported?.products_done === true,
    productCount: imported?.product_count ?? 0,
    variantCount: imported?.variant_count ?? 0,
    openOrdersDone: imported?.open_orders_done === true,
    openOrdersCount: imported?.open_orders_count ?? 0,
    historyDone: imported?.history_done === true,
    historyOrdersCount: imported?.history_orders_count ?? 0,
  };
}

/**
 * Products count as imported when this onboarding run finished them, or when
 * a full product sync for the shop already completed.
 */
export async function resolveOnboardingImport(
  shopId: string,
): Promise<OnboardingImportState> {
  const state = await getOnboardingImport(shopId);
  if (state.productsDone) return state;

  const { getLatestCompletedProductSync } = await import(
    "@/server/shopify/product-sync-run"
  );
  const completed = await getLatestCompletedProductSync(shopId);
  if (!completed) return state;

  return {
    ...state,
    productsDone: true,
    productCount: completed.productCount,
    variantCount: completed.variantCount,
  };
}

export async function markOnboardingProductsImported(
  shopId: string,
  productCount: number,
  variantCount: number,
): Promise<void> {
  await adminDb()
    .collection(Collections.Shops)
    .doc(normalizeShopId(shopId))
    .update({
      "onboarding_import.products_done": true,
      "onboarding_import.product_count": productCount,
      "onboarding_import.variant_count": variantCount,
      updated_at: FieldValue.serverTimestamp(),
    });
}

export async function markOnboardingOrdersImported(
  shopId: string,
  stage: "open" | "history",
  count: number,
): Promise<void> {
  const patch =
    stage === "open"
      ? {
          "onboarding_import.open_orders_done": true,
          "onboarding_import.open_orders_count": count,
        }
      : {
          "onboarding_import.history_done": true,
          "onboarding_import.history_orders_count": count,
        };
  await adminDb()
    .collection(Collections.Shops)
    .doc(normalizeShopId(shopId))
    .update({
      ...patch,
      updated_at: FieldValue.serverTimestamp(),
    });
}

export async function saveOnboardingStep(
  shopId: string,
  step: number,
): Promise<void> {
  const clamped = Math.max(0, Math.min(step, ONBOARDING_STEP_COUNT - 1));
  await adminDb()
    .collection(Collections.Shops)
    .doc(normalizeShopId(shopId))
    .set(
      {
        onboarding_step: clamped,
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

export async function completeOnboarding(shopId: string): Promise<void> {
  await adminDb()
    .collection(Collections.Shops)
    .doc(normalizeShopId(shopId))
    .set(
      {
        onboarding_step: ONBOARDING_STEP_COUNT - 1,
        onboarding_completed_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}
