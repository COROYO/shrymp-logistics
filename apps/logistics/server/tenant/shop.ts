import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  ConfigDocs,
  ShopSchema,
  type DhlConfig,
  type Shop,
} from "@/server/firestore/schema";
import { log } from "@/lib/logger";
import { normalizeShopId } from "./id";

function shopRef(shopId: string) {
  return adminDb().collection(Collections.Shops).doc(normalizeShopId(shopId));
}

export async function getShop(shopId: string): Promise<Shop | null> {
  const snap = await shopRef(shopId).get();
  if (!snap.exists) return null;
  const parsed = ShopSchema.safeParse({ id: snap.id, ...snap.data() });
  return parsed.success ? parsed.data : null;
}

export async function listActiveShops(): Promise<Shop[]> {
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

export async function upsertShopOAuth(
  shopDomain: string,
  accessToken: string,
  scope: string,
): Promise<string> {
  const shopId = normalizeShopId(shopDomain);
  const ref = shopRef(shopId);
  const existing = await ref.get();
  await ref.set(
    {
      id: shopId,
      shop_domain: shopId,
      status: "ACTIVE",
      access_token: accessToken,
      scope,
      installed_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
      ...(existing.exists
        ? {}
        : { created_at: FieldValue.serverTimestamp(), api_version: "2026-04" }),
    },
    { merge: true },
  );
  log.info("shop_oauth_persisted", { shopId, scope });
  return shopId;
}

export async function markShopUninstalled(shopId: string): Promise<void> {
  await shopRef(shopId).set(
    {
      status: "UNINSTALLED",
      access_token: FieldValue.delete(),
      updated_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function updateShopMeta(
  shopId: string,
  patch: {
    location_gid?: string;
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
    batch_min_days_before_expiry: number;
    updated_by_uid: string | null;
  },
): Promise<void> {
  await shopRef(shopId).set(
    {
      batch_min_days_before_expiry: patch.batch_min_days_before_expiry,
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

/**
 * One-time lift from legacy singleton `config/*` docs into `shops/{shopId}`.
 * Returns the migrated shop id, or null if nothing to migrate.
 */
export async function migrateLegacyShopIfNeeded(): Promise<string | null> {
  const db = adminDb();
  const [tokenSnap, metaSnap, lagerSnap, dhlSnap] = await Promise.all([
    db.collection(Collections.Config).doc(ConfigDocs.ShopifyToken).get(),
    db.collection(Collections.Config).doc(ConfigDocs.ShopifyMeta).get(),
    db.collection(Collections.Config).doc(ConfigDocs.LagerConfig).get(),
    db.collection(Collections.Config).doc(ConfigDocs.DhlConfig).get(),
  ]);
  if (!tokenSnap.exists) return null;

  const token = tokenSnap.data() ?? {};
  const shopDomain = (token.shop_domain as string | undefined)?.trim();
  const accessToken = token.access_token as string | undefined;
  if (!shopDomain || !accessToken) return null;

  const shopId = normalizeShopId(shopDomain);
  const existing = await shopRef(shopId).get();
  if (existing.exists) return shopId;

  const meta = metaSnap.data() ?? {};
  const lager = lagerSnap.data() ?? {};
  const dhl = dhlSnap.exists ? dhlSnap.data() : undefined;

  await shopRef(shopId).set({
    id: shopId,
    shop_domain: shopId,
    status: "ACTIVE",
    access_token: accessToken,
    scope: (token.scope as string | undefined) ?? "",
    installed_at: token.installed_at ?? FieldValue.serverTimestamp(),
    location_gid: meta.location_gid as string | undefined,
    api_version: (meta.api_version as string | undefined) ?? "2026-04",
    batch_min_days_before_expiry:
      (lager.batch_min_days_before_expiry as number | undefined) ?? 10,
    ...(dhl ? { dhl_config: dhl } : {}),
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });

  log.info("legacy_shop_migrated", { shopId });
  return shopId;
}

export type ShopCredentials = {
  shop_domain: string;
  access_token: string;
  scope: string;
};

export async function loadShopCredentials(
  shopId: string,
): Promise<ShopCredentials | null> {
  await migrateLegacyShopIfNeeded();
  const shop = await getShop(shopId);
  if (!shop?.access_token) return null;
  return {
    shop_domain: shop.shop_domain,
    access_token: shop.access_token,
    scope: shop.scope ?? "",
  };
}
