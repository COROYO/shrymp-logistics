import "server-only";
import { cache } from "react";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  ShopSchema,
  type DhlConfig,
  type Shop,
} from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { normalizeShopId } from "./id";

function shopRef(shopId: string) {
  return adminDb().collection(Collections.Shops).doc(normalizeShopId(shopId));
}

async function getShopUncached(shopId: string): Promise<Shop | null> {
  const snap = await shopRef(shopId).get();
  if (!snap.exists) return null;
  const parsed = ShopSchema.safeParse({ id: snap.id, ...snap.data() });
  return parsed.success ? parsed.data : null;
}

export const getShop = cache(getShopUncached);

async function listActiveShopsUncached(): Promise<Shop[]> {
  const snap = await adminDb()
    .collection(Collections.Shops)
    .where("status", "==", "ACTIVE")
    .get();
  const out: Shop[] = [];
  for (const d of snap.docs) {
    const parsed = ShopSchema.safeParse({ id: d.id, ...d.data() });
    if (parsed.success) out.push(parsed.data);
  }
  return out.sort((a, b) => a.shop_domain.localeCompare(b.shop_domain));
}

export const listActiveShops = cache(listActiveShopsUncached);

export async function upsertShopOAuth(
  shopDomain: string,
  tokens: ShopOAuthTokenBundle,
): Promise<string> {
  const shopId = normalizeShopId(shopDomain);
  await saveShopOAuthTokens(shopId, tokens, { isInstall: true });
  return shopId;
}

export type ShopOAuthTokenBundle = {
  accessToken: string;
  scope: string;
  refreshToken?: string;
  accessTokenExpiresAtMs?: number;
  refreshTokenExpiresAtMs?: number;
};

export async function saveShopOAuthTokens(
  shopId: string,
  tokens: ShopOAuthTokenBundle,
  opts: { isInstall?: boolean } = {},
): Promise<void> {
  const ref = shopRef(shopId);
  const existing = await ref.get();
  const existingScope =
    existing.exists && typeof existing.data()?.scope === "string"
      ? existing.data()!.scope
      : undefined;
  const patch: Record<string, unknown> = {
    id: shopId,
    shop_domain: shopId,
    status: "ACTIVE",
    access_token: tokens.accessToken,
    scope: tokens.scope?.trim() ? tokens.scope : (existingScope ?? ""),
    updated_at: FieldValue.serverTimestamp(),
  };
  if (tokens.refreshToken) patch.refresh_token = tokens.refreshToken;
  if (tokens.accessTokenExpiresAtMs !== undefined) {
    patch.access_token_expires_at = Timestamp.fromMillis(
      tokens.accessTokenExpiresAtMs,
    );
  }
  if (tokens.refreshTokenExpiresAtMs !== undefined) {
    patch.refresh_token_expires_at = Timestamp.fromMillis(
      tokens.refreshTokenExpiresAtMs,
    );
  }
  if (opts.isInstall) {
    patch.installed_at = FieldValue.serverTimestamp();
    if (!existing.exists) {
      patch.created_at = FieldValue.serverTimestamp();
      patch.api_version = "2026-04";
      patch.test_mode = true;
    }
  }
  await ref.set(patch, { merge: true });
  log.info("shop_oauth_persisted", { shopId, scope: tokens.scope });
}

export async function markShopUninstalled(shopId: string): Promise<void> {
  await shopRef(shopId).set(
    {
      status: "UNINSTALLED",
      access_token: FieldValue.delete(),
      refresh_token: FieldValue.delete(),
      access_token_expires_at: FieldValue.delete(),
      refresh_token_expires_at: FieldValue.delete(),
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function updateShopMeta(
  shopId: string,
  patch: {
    location_gid?: string;
    default_location_id?: string;
    api_version?: string;
    shop_domain?: string;
  },
): Promise<void> {
  await shopRef(shopId).set(
    {
      ...patch,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function updateShopLagerSettings(
  shopId: string,
  patch: {
    batches_enabled: boolean;
    batch_min_days_before_expiry: number;
    catalog_sync_to_shopify?: boolean;
    updated_by_uid: string | null;
  },
): Promise<void> {
  const body: Record<string, unknown> = {
    batches_enabled: patch.batches_enabled,
    batch_min_days_before_expiry: patch.batch_min_days_before_expiry,
    lager_updated_by_uid: patch.updated_by_uid,
    lager_updated_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  };
  if (patch.catalog_sync_to_shopify !== undefined) {
    body.catalog_sync_to_shopify = patch.catalog_sync_to_shopify;
  }
  await shopRef(shopId).set(body, { merge: true });
}

export async function updateShopInventorySource(
  shopId: string,
  patch: {
    inventory_source: "APP" | "SHOPIFY";
    updated_by_uid: string | null;
  },
): Promise<void> {
  await shopRef(shopId).set(
    {
      inventory_source: patch.inventory_source,
      lager_updated_by_uid: patch.updated_by_uid,
      lager_updated_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function updateShopDhlConfig(
  shopId: string,
  dhlConfig: DhlConfig,
): Promise<void> {
  await shopRef(shopId).set(
    {
      dhl_config: dhlConfig,
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function updateShopTestMode(
  shopId: string,
  patch: {
    test_mode: boolean;
    updated_by_uid: string | null;
  },
): Promise<void> {
  await shopRef(shopId).set(
    {
      test_mode: patch.test_mode,
      lager_updated_by_uid: patch.updated_by_uid,
      lager_updated_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function updateShopSlipBranding(
  shopId: string,
  branding: Record<string, unknown>,
  updatedByUid: string | null,
): Promise<void> {
  await shopRef(shopId).set(
    {
      slip_branding: {
        ...branding,
        updated_by_uid: updatedByUid,
        updated_at: FieldValue.serverTimestamp(),
      },
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export type ShopCredentials = {
  shop_domain: string;
  access_token: string;
  scope: string;
  refresh_token?: string;
  access_token_expires_at_ms?: number;
};

export async function loadShopCredentials(
  shopId: string,
): Promise<ShopCredentials | null> {
  const { ensureValidShopCredentials } = await import(
    "@/server/shopify/token"
  );
  return ensureValidShopCredentials(shopId);
}
