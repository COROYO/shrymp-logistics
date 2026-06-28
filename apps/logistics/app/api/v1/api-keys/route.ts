import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiContext } from "@/server/api/context";
import {
  createApiKey,
  listApiKeysForShop,
  revokeApiKey,
} from "@/server/api/keys";
import { apiError, apiJson } from "@/server/api/response";
import { ApiScopeSchema } from "@/server/firestore/schema";

const CreateBody = z.object({
  label: z.string().min(1).max(80),
  scopes: z.array(ApiScopeSchema).min(1),
});

/** List API keys for the active shop (session auth only). */
export async function GET(req: Request) {
  const ctx = await resolveApiContext(req);
  if (!ctx || ctx.auth.kind !== "session") {
    return apiError(401, "unauthorized");
  }
  if (ctx.auth.user.role !== "ADMIN") {
    return apiError(403, "forbidden");
  }

  const keys = await listApiKeysForShop(ctx.shopId);
  return apiJson(
    {
      keys: keys.map((k) => ({
        id: k.id,
        label: k.label,
        scopes: k.scopes,
        created_at: k.created_at,
        last_used_at: k.last_used_at ?? null,
      })),
    },
    ctx.shopId,
  );
}

/** Create a new API key — raw key returned once in the response. */
export async function POST(req: Request) {
  const ctx = await resolveApiContext(req);
  if (!ctx || ctx.auth.kind !== "session") {
    return apiError(401, "unauthorized");
  }
  if (ctx.auth.user.role !== "ADMIN") {
    return apiError(403, "forbidden");
  }

  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await req.json());
  } catch {
    return apiError(400, "invalid_body");
  }

  const { rawKey, record } = await createApiKey({
    shopId: ctx.shopId,
    label: body.label,
    scopes: body.scopes,
    createdByUid: ctx.auth.user.uid,
  });

  return apiJson(
    {
      key: rawKey,
      id: record.id,
      label: record.label,
      scopes: record.scopes,
    },
    ctx.shopId,
  );
}

const RevokeBody = z.object({ id: z.string().min(1) });

/** Revoke an API key by hash id. */
export async function DELETE(req: Request) {
  const ctx = await resolveApiContext(req);
  if (!ctx || ctx.auth.kind !== "session") {
    return apiError(401, "unauthorized");
  }
  if (ctx.auth.user.role !== "ADMIN") {
    return apiError(403, "forbidden");
  }

  let body: z.infer<typeof RevokeBody>;
  try {
    body = RevokeBody.parse(await req.json());
  } catch {
    return apiError(400, "invalid_body");
  }

  const keys = await listApiKeysForShop(ctx.shopId);
  if (!keys.some((k) => k.id === body.id)) {
    return apiError(404, "not_found");
  }

  await revokeApiKey(body.id);
  return apiJson({ revoked: true }, ctx.shopId);
}
