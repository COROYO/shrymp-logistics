import "server-only";

import { NextResponse } from "next/server";
import { resolveApiContext } from "@/server/api/context";
import { apiError, apiJson } from "@/server/api/response";
import type { ApiContext } from "@/server/api/types";
import type { ApiScope } from "@/server/firestore/schema";

export type ApiHandler = (
  ctx: ApiContext,
  req: Request,
) => Promise<Record<string, unknown>>;

export function defineApiRoute(
  scopes: ApiScope[],
  handler: ApiHandler,
): (req: Request) => Promise<NextResponse> {
  return async (req: Request) => {
    const ctx = await resolveApiContext(req, scopes);
    if (!ctx) {
      return apiError(401, "unauthorized", "Missing or invalid credentials");
    }
    try {
      const data = await handler(ctx, req);
      return apiJson(data, ctx.shopId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return apiError(500, "internal_error", message);
    }
  };
}
