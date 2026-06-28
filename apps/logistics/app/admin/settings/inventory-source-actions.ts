"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import { updateShopInventorySource } from "@/server/tenant/shop";
import { InventorySourceSchema } from "@/server/firestore/schema";
import { log } from "@/lib/logger";

const InputSchema = z.object({
  inventory_source: InventorySourceSchema,
});

export type SaveInventorySourceResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

export async function saveInventorySourceAction(
  formData: FormData,
): Promise<SaveInventorySourceResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = InputSchema.safeParse({
    inventory_source: formData.get("inventory_source"),
  });
  if (!parsed.success) {
    return { ok: false, error: "validation", details: parsed.error.flatten() };
  }

  const shopId = await requireActiveShopId(user);
  await updateShopInventorySource(shopId, {
    inventory_source: parsed.data.inventory_source,
    updated_by_uid: user.uid,
  });

  log.info("inventory_source_saved", {
    uid: user.uid,
    shopId,
    inventory_source: parsed.data.inventory_source,
  });

  revalidatePath("/admin/settings");
  revalidatePath("/admin/settings/bestand");
  return { ok: true };
}
