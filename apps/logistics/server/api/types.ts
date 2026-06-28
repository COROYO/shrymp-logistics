import "server-only";

import type { ApiScope } from "@/server/firestore/schema";
import type { SessionUser } from "@/lib/auth/session";

export type ApiSessionAuth = {
  kind: "session";
  user: SessionUser;
};

export type ApiKeyAuth = {
  kind: "api_key";
  keyId: string;
  scopes: ApiScope[];
};

export type ApiAuth = ApiSessionAuth | ApiKeyAuth;

export type ApiContext = {
  shopId: string;
  auth: ApiAuth;
};

export function hasApiScope(ctx: ApiContext, scope: ApiScope): boolean {
  if (ctx.auth.kind === "session") return true;
  return ctx.auth.scopes.includes(scope);
}

export function requireApiScopes(ctx: ApiContext, scopes: ApiScope[]): boolean {
  return scopes.every((s) => hasApiScope(ctx, s));
}
