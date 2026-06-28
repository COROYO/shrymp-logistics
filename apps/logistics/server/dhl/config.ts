import "server-only";
import { adminDb } from "@/server/firestore/admin";
import {
  Collections,
  ConfigDocs,
  DhlConfigSchema,
  type DhlConfig,
} from "@/server/firestore/schema";
import { getShop } from "@/server/tenant/shop";
import { normalizeShopId } from "@/server/tenant/id";
import { getTenantShopIdFromContext } from "@/server/tenant/context";

function resolveShopId(shopId?: string): string {
  const id = shopId ?? getTenantShopIdFromContext();
  if (!id) throw new Error("shopId required for DHL config");
  return normalizeShopId(id);
}

/** Per-shop DHL config from `shops/{shopId}.dhl_config`, legacy fallback. */
export async function loadDhlConfig(shopId?: string): Promise<DhlConfig | null> {
  const id = resolveShopId(shopId);
  const shop = await getShop(id);
  if (shop?.dhl_config) {
    const parsed = DhlConfigSchema.safeParse(shop.dhl_config);
    if (parsed.success) return parsed.data;
  }

  const snap = await adminDb()
    .collection(Collections.Config)
    .doc(ConfigDocs.DhlConfig)
    .get();
  if (!snap.exists) return null;
  const parsed = DhlConfigSchema.safeParse(snap.data());
  if (!parsed.success) return null;
  return parsed.data;
}

export class DhlConfigError extends Error {
  constructor(
    public readonly code:
      | "not_configured"
      | "billing_number_missing"
      | "credentials_missing"
      | "client_credentials_missing",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "DhlConfigError";
  }
}

/** Throw when any required field for an API call is missing. */
export function assertDhlReady(cfg: DhlConfig | null): asserts cfg is DhlConfig {
  if (!cfg) throw new DhlConfigError("not_configured");
  if (!cfg.billing_number || cfg.billing_number.length !== 14) {
    throw new DhlConfigError("billing_number_missing");
  }
  if (!cfg.gkp_username || !cfg.gkp_password) {
    throw new DhlConfigError("credentials_missing");
  }
  if (!cfg.api_key || !cfg.api_secret) {
    throw new DhlConfigError("client_credentials_missing");
  }
}

export function dhlBaseUrl(cfg: Pick<DhlConfig, "sandbox">): string {
  return cfg.sandbox
    ? "https://api-sandbox.dhl.com/parcel/de/shipping/v2"
    : "https://api-eu.dhl.com/parcel/de/shipping/v2";
}

export function dhlAuthUrl(cfg: Pick<DhlConfig, "sandbox">): string {
  return cfg.sandbox
    ? "https://api-sandbox.dhl.com/parcel/de/account/auth/ropc/v1/token"
    : "https://api-eu.dhl.com/parcel/de/account/auth/ropc/v1/token";
}
