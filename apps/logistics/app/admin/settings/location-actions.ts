"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { log } from "@/lib/logger";

const CreateLocationSchema = z.object({
  name: z.string().min(1).max(120),
  address1: z.string().min(1).max(200),
  city: z.string().min(1).max(120),
  zip: z.string().min(1).max(20),
  countryCode: z.string().length(2).optional(),
  phone: z.string().max(40).optional(),
});

export type CreateLocationResult =
  | { ok: true; locationId: string; name: string }
  | { ok: false; error: string };

export async function createLocationAction(
  payload: z.infer<typeof CreateLocationSchema>,
): Promise<CreateLocationResult> {
  try {
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = CreateLocationSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }

  try {
    const user = await requireRole("ADMIN");
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const shopId = await requireActiveShopId(user);
    const { createLocationAndSyncToShopify } = await import(
      "@/server/locations/create-location"
    );
    const result = await createLocationAndSyncToShopify(shopId, parsed.data);
    revalidatePath("/admin/settings/shopify");
    revalidatePath("/admin/products");
    return { ok: true, locationId: result.locationId, name: result.name };
  } catch (e) {
    log.warn("create_location_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function listLocationsAction(): Promise<
  | {
      ok: true;
      rows: Array<{
        id: string;
        name: string;
        isPrimary: boolean;
        active: boolean;
        shopifyGid: string;
      }>;
      defaultLocationId: string | null;
    }
  | { ok: false; error: string }
> {
  try {
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  try {
    const user = await requireRole("ADMIN");
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const { adminDb } = await import("@/server/firestore/admin");
    const shopId = await requireActiveShopId(user);
    const { locationsForShop } = await import("@/server/tenant/queries");
    const { getShop } = await import("@/server/tenant/shop");
    const snap = await locationsForShop(adminDb(), shopId).get();
    const shop = await getShop(shopId);
    const rows = snap.docs
      .map((d) => d.data())
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
      .map((l) => ({
        id: l.id as string,
        name: l.name as string,
        isPrimary: l.is_primary as boolean,
        active: l.active as boolean,
        shopifyGid: l.shopify_gid as string,
      }));

    return {
      ok: true,
      rows,
      defaultLocationId: shop?.default_location_id ?? null,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function syncLocationsAction(): Promise<
  { ok: true; count: number } | { ok: false; error: string }
> {
  try {
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  try {
    const user = await requireRole("ADMIN");
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const shopId = await requireActiveShopId(user);
    const { syncLocationsFromShopify } = await import(
      "@/server/locations/sync-from-shopify"
    );
    const { updateShopMeta } = await import("@/server/tenant/shop");
    const result = await syncLocationsFromShopify(shopId);
    await updateShopMeta(shopId, {
      location_gid: result.primaryLocationGid,
    });
    revalidatePath("/admin/settings/standorte");
    revalidatePath("/admin/settings/shopify");
    revalidatePath("/admin/products");
    return { ok: true, count: result.count };
  } catch (e) {
    log.warn("sync_locations_failed", { error: String(e) });
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function setDefaultLocationAction(
  locationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  if (!locationId.trim()) {
    return { ok: false, error: "location_required" };
  }

  try {
    const user = await requireRole("ADMIN");
    const { requireActiveShopId } = await import("@/lib/auth/tenant");
    const shopId = await requireActiveShopId(user);
    const { updateShopMeta } = await import("@/server/tenant/shop");
    await updateShopMeta(shopId, { default_location_id: locationId });
    revalidatePath("/admin/settings/standorte");
    revalidatePath("/admin/products");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
