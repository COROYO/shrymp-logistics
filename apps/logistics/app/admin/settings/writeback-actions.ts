"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import { updateShopWriteback } from "@/server/tenant/shop";
import { normalizeShopifyTag, shopifyTagError } from "@/lib/lager/writeback";
import { log } from "@/lib/logger";

const InputSchema = z.object({
  catalog_sync_to_shopify: z.boolean(),
  shopify_writeback_tags: z.boolean(),
  shopify_writeback_fulfillment: z.boolean(),
  shopify_fulfillment_notify_customer: z.boolean(),
  shopify_writeback_inventory: z.boolean(),
  shopify_tag_ship: z.string(),
  shopify_tag_stop: z.string(),
  shopify_tag_packed: z.string(),
});

export type SaveWritebackResult =
  | { ok: true }
  | { ok: false; error: string };

function flag(formData: FormData, name: string): boolean {
  return formData.get(name) === "1";
}

export async function saveWritebackAction(
  formData: FormData,
): Promise<SaveWritebackResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "Keine Berechtigung." };
  }

  const tagShip = normalizeShopifyTag(String(formData.get("shopify_tag_ship") ?? ""));
  const tagStop = normalizeShopifyTag(String(formData.get("shopify_tag_stop") ?? ""));
  const tagPacked = normalizeShopifyTag(
    String(formData.get("shopify_tag_packed") ?? ""),
  );
  for (const tag of [tagShip, tagStop, tagPacked]) {
    const err = shopifyTagError(tag);
    if (err) return { ok: false, error: err };
  }

  const parsed = InputSchema.safeParse({
    catalog_sync_to_shopify: flag(formData, "catalog_sync_to_shopify"),
    shopify_writeback_tags: flag(formData, "shopify_writeback_tags"),
    shopify_writeback_fulfillment: flag(formData, "shopify_writeback_fulfillment"),
    shopify_fulfillment_notify_customer: flag(
      formData,
      "shopify_fulfillment_notify_customer",
    ),
    shopify_writeback_inventory: flag(formData, "shopify_writeback_inventory"),
    shopify_tag_ship: tagShip,
    shopify_tag_stop: tagStop,
    shopify_tag_packed: tagPacked,
  });
  if (!parsed.success) {
    return { ok: false, error: "Ungültige Eingabe." };
  }

  const shopId = await requireActiveShopId(user);
  await updateShopWriteback(shopId, {
    ...parsed.data,
    updated_by_uid: user.uid,
  });

  log.info("shopify_writeback_saved", {
    uid: user.uid,
    shopId,
    tags: parsed.data.shopify_writeback_tags,
    fulfillment: parsed.data.shopify_writeback_fulfillment,
    inventory: parsed.data.shopify_writeback_inventory,
    catalog: parsed.data.catalog_sync_to_shopify,
  });

  revalidatePath("/admin/settings");
  revalidatePath("/admin/settings/shopify");
  revalidatePath("/admin/settings/bestand");
  revalidatePath("/admin/products");
  return { ok: true };
}
