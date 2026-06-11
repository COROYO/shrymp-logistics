import "server-only";
import { adminDb } from "@/server/firestore/admin";
import { DEFAULT_BATCH_MIN_DAYS_BEFORE_EXPIRY } from "@/lib/lager/defaults";
import {
  Collections,
  ConfigDocs,
  LagerConfigSchema,
  type LagerConfig,
} from "@/server/firestore/schema";

/** Firestore singleton `config/lager_config`, editable from Admin → Einstellungen. */
export async function loadLagerConfig(): Promise<LagerConfig> {
  const snap = await adminDb()
    .collection(Collections.Config)
    .doc(ConfigDocs.LagerConfig)
    .get();
  const parsed = LagerConfigSchema.safeParse(snap.data());
  if (parsed.success) return parsed.data;
  return LagerConfigSchema.parse({
    batch_min_days_before_expiry: DEFAULT_BATCH_MIN_DAYS_BEFORE_EXPIRY,
    updated_at: new Date(),
    updated_by_uid: null,
  });
}
