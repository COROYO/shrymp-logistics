"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import { updateShopTestMode } from "@/server/tenant/shop";
import { log } from "@/lib/logger";

export type SaveTestModeResult = { ok: true } | { ok: false; error: string };

export async function saveTestModeAction(
  formData: FormData,
): Promise<SaveTestModeResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const shopId = await requireActiveShopId(user);
  const testMode = formData.get("test_mode") === "1";

  await updateShopTestMode(shopId, {
    test_mode: testMode,
    updated_by_uid: user.uid,
  });

  log.info("test_mode_saved", { uid: user.uid, shopId, test_mode: testMode });

  revalidatePath("/admin");
  revalidatePath("/admin/settings/shopify");
  return { ok: true };
}
