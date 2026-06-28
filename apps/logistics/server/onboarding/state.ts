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
  if (await merchantNeedsShopifyConnect(user)) return false;
  const shopId = await requireActiveShopId(user);
  return shopNeedsOnboarding(shopId);
}

export async function getOnboardingStep(shopId: string): Promise<number> {
  const shop = await getShop(normalizeShopId(shopId));
  return shop?.onboarding_step ?? 0;
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
