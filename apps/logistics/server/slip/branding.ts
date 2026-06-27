import "server-only";
import {
  resolveSlipBranding,
  type SlipBrandingConfig,
} from "@/lib/slip/defaults";
import { getShop } from "@/server/tenant/shop";
import { SlipBrandingSchema } from "@/server/firestore/schema";

export type { SlipBrandingConfig };

export async function loadSlipBranding(
  shopId: string | undefined | null,
): Promise<SlipBrandingConfig> {
  if (!shopId) return resolveSlipBranding(null);
  const shop = await getShop(shopId);
  const parsed = SlipBrandingSchema.partial().safeParse(shop?.slip_branding);
  return resolveSlipBranding(parsed.success ? parsed.data : null);
}
