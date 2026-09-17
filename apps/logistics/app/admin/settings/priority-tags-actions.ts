"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import { updateShopPriorityTags } from "@/server/tenant/shop";
import { log } from "@/lib/logger";
import { parsePriorityTagsInput } from "@/lib/lager/priority-tags";

const InputSchema = z.object({
  priority_tags: z.array(z.string().min(1).max(100)).max(50),
});

export type SavePriorityTagsResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

export async function savePriorityTagsAction(
  formData: FormData,
): Promise<SavePriorityTagsResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const tags = parsePriorityTagsInput(
    String(formData.get("priority_tags") ?? ""),
  );
  const parsed = InputSchema.safeParse({ priority_tags: tags });
  if (!parsed.success) {
    return { ok: false, error: "validation", details: parsed.error.flatten() };
  }

  const shopId = await requireActiveShopId(user);
  await updateShopPriorityTags(shopId, {
    priority_tags: parsed.data.priority_tags,
    updated_by_uid: user.uid,
  });

  log.info("priority_tags_saved", {
    uid: user.uid,
    shopId,
    priority_tags: parsed.data.priority_tags,
  });

  revalidatePath("/admin/settings");
  revalidatePath("/admin/settings/auftraege");
  revalidatePath("/lager/picking");
  revalidatePath("/admin/orders");
  return { ok: true };
}
