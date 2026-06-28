import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  ApiKeySchema,
  Collections,
  type ApiKey,
  type ApiScope,
} from "@/server/firestore/schema";

const KEY_PREFIX = "sk_live_";

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function generateApiKeyRaw(): string {
  return `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isApiKeyToken(token: string): boolean {
  return token.startsWith(KEY_PREFIX);
}

export async function lookupApiKey(raw: string): Promise<ApiKey | null> {
  const id = hashApiKey(raw);
  const snap = await adminDb().collection(Collections.ApiKeys).doc(id).get();
  if (!snap.exists) return null;
  const parsed = ApiKeySchema.safeParse({ id: snap.id, ...snap.data() });
  if (!parsed.success) return null;
  if (parsed.data.revoked_at) return null;
  return parsed.data;
}

export async function touchApiKeyLastUsed(keyId: string): Promise<void> {
  await adminDb()
    .collection(Collections.ApiKeys)
    .doc(keyId)
    .set({ last_used_at: FieldValue.serverTimestamp() }, { merge: true });
}

export async function createApiKey(opts: {
  shopId: string;
  label: string;
  scopes: ApiScope[];
  createdByUid: string | null;
}): Promise<{ rawKey: string; record: ApiKey }> {
  const rawKey = generateApiKeyRaw();
  const id = hashApiKey(rawKey);
  const record: ApiKey = {
    id,
    shop_id: opts.shopId,
    label: opts.label.trim(),
    scopes: opts.scopes,
    created_at: new Date(),
    created_by_uid: opts.createdByUid,
  };
  await adminDb()
    .collection(Collections.ApiKeys)
    .doc(id)
    .set({
      shop_id: record.shop_id,
      label: record.label,
      scopes: record.scopes,
      created_by_uid: record.created_by_uid,
      created_at: FieldValue.serverTimestamp(),
    });
  return { rawKey, record };
}

export async function listApiKeysForShop(shopId: string): Promise<ApiKey[]> {
  const snap = await adminDb()
    .collection(Collections.ApiKeys)
    .where("shop_id", "==", shopId)
    .get();
  const out: ApiKey[] = [];
  for (const d of snap.docs) {
    const parsed = ApiKeySchema.safeParse({ id: d.id, ...d.data() });
    if (parsed.success && !parsed.data.revoked_at) out.push(parsed.data);
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export async function revokeApiKey(keyId: string): Promise<void> {
  await adminDb()
    .collection(Collections.ApiKeys)
    .doc(keyId)
    .set({ revoked_at: FieldValue.serverTimestamp() }, { merge: true });
}
