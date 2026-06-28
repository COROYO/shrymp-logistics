"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import {
  createApiKey,
  listApiKeysForShop,
  revokeApiKey,
} from "@/server/api/keys";
import { ApiScopeSchema, type ApiScope } from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { API_SCOPES } from "./api/shared";

const CreateSchema = z.object({
  label: z.string().trim().min(1).max(80),
  scopes: z.array(ApiScopeSchema).min(1),
});

const RevokeSchema = z.object({
  id: z.string().min(1),
});

export type ApiKeyActionResult =
  | { ok: true }
  | { ok: false; error: string };

export type CreateApiKeyActionResult =
  | {
      ok: true;
      key: string;
      id: string;
      label: string;
      scopes: ApiScope[];
    }
  | { ok: false; error: string };

async function adminShopContext() {
  const user = await requireRole("ADMIN");
  const shopId = await requireActiveShopId(user);
  return { user, shopId };
}

export async function createApiKeyAction(
  formData: FormData,
): Promise<CreateApiKeyActionResult> {
  let ctx;
  try {
    ctx = await adminShopContext();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const scopes = API_SCOPES.filter(
    (scope) => formData.get(`scope_${scope}`) === "1",
  );
  const parsed = CreateSchema.safeParse({
    label: formData.get("label"),
    scopes,
  });
  if (!parsed.success) {
    return { ok: false, error: "validation" };
  }

  const { rawKey, record } = await createApiKey({
    shopId: ctx.shopId,
    label: parsed.data.label,
    scopes: parsed.data.scopes,
    createdByUid: ctx.user.uid,
  });

  log.info("api_key_created", {
    shopId: ctx.shopId,
    uid: ctx.user.uid,
    keyId: record.id,
    scopes: record.scopes,
  });

  revalidatePath("/admin/settings/api");
  return {
    ok: true,
    key: rawKey,
    id: record.id,
    label: record.label,
    scopes: record.scopes,
  };
}

export async function revokeApiKeyAction(
  formData: FormData,
): Promise<ApiKeyActionResult> {
  let ctx;
  try {
    ctx = await adminShopContext();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = RevokeSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { ok: false, error: "validation" };

  const keys = await listApiKeysForShop(ctx.shopId);
  if (!keys.some((k) => k.id === parsed.data.id)) {
    return { ok: false, error: "not_found" };
  }

  await revokeApiKey(parsed.data.id);
  log.info("api_key_revoked", {
    shopId: ctx.shopId,
    uid: ctx.user.uid,
    keyId: parsed.data.id,
  });

  revalidatePath("/admin/settings/api");
  return { ok: true };
}
