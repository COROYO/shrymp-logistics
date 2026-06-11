"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { requireRole } from "@/lib/auth/session";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  ConfigDocs,
  LagerConfigSchema,
} from "@/server/firestore/schema";
import { log } from "@/lib/logger";

const InputSchema = z.object({
  batch_min_days_before_expiry: z.coerce.number().int().min(0).max(365),
});

export type SaveLagerConfigResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

export async function saveLagerConfigAction(
  formData: FormData,
): Promise<SaveLagerConfigResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = InputSchema.safeParse({
    batch_min_days_before_expiry: formData.get(
      "batch_min_days_before_expiry",
    ),
  });
  if (!parsed.success) {
    return { ok: false, error: "validation", details: parsed.error.flatten() };
  }

  const docPayload = LagerConfigSchema.parse({
    batch_min_days_before_expiry: parsed.data.batch_min_days_before_expiry,
    updated_at: FieldValue.serverTimestamp(),
    updated_by_uid: user.uid,
  });

  await adminDb()
    .collection(Collections.Config)
    .doc(ConfigDocs.LagerConfig)
    .set(docPayload, { merge: true });

  log.info("lager_config_saved", {
    uid: user.uid,
    batch_min_days_before_expiry: parsed.data.batch_min_days_before_expiry,
  });

  revalidatePath("/admin/settings");
  return { ok: true };
}
