"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import { runWithTenantAsync } from "@/server/tenant/context";
import {
  assignVariantToBin,
  BinError,
  bulkCreateBins,
  createBin,
  deleteBin,
  listBins,
  listVariantsWithBins,
  updateBin,
  type AssignableVariant,
  type BinRow,
} from "@/server/warehouse/bins";
import { log } from "@/lib/logger";

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };
type Result<T> = Ok<T> | Err;

async function ctx() {
  const user = await requireRole("ADMIN");
  const shopId = await requireActiveShopId(user);
  return { user, shopId };
}

function errMessage(e: unknown): string {
  if (e instanceof BinError) return e.code;
  return e instanceof Error ? e.message : "unknown";
}

export async function listBinsAction(): Promise<Result<{ rows: BinRow[] }>> {
  try {
    const { shopId } = await ctx();
    const rows = await runWithTenantAsync(shopId, () => listBins(shopId));
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: errMessage(e) };
  }
}

export async function createBinAction(input: {
  code: string;
  name: string;
  zone?: string;
  note?: string;
}): Promise<Result<{ row: BinRow }>> {
  try {
    const { shopId, user } = await ctx();
    const row = await runWithTenantAsync(shopId, () =>
      createBin(shopId, input, user.uid),
    );
    revalidatePath("/admin/lagerplaetze");
    return { ok: true, row };
  } catch (e) {
    log.warn("create_bin_failed", { error: String(e) });
    return { ok: false, error: errMessage(e) };
  }
}

export async function bulkCreateBinsAction(input: {
  prefix: string;
  suffix?: string;
  start: number;
  count: number;
  padding: number;
  zone?: string;
  namePrefix?: string;
}): Promise<Result<{ created: number; skipped: number }>> {
  try {
    const { shopId, user } = await ctx();
    const res = await runWithTenantAsync(shopId, () =>
      bulkCreateBins(shopId, input, user.uid),
    );
    revalidatePath("/admin/lagerplaetze");
    return { ok: true, ...res };
  } catch (e) {
    log.warn("bulk_create_bins_failed", { error: String(e) });
    return { ok: false, error: errMessage(e) };
  }
}

export async function updateBinAction(
  binId: string,
  patch: { code?: string; name?: string; zone?: string; note?: string; active?: boolean },
): Promise<Result<unknown>> {
  try {
    const { shopId, user } = await ctx();
    await runWithTenantAsync(shopId, () =>
      updateBin(shopId, binId, patch, user.uid),
    );
    revalidatePath("/admin/lagerplaetze");
    return { ok: true };
  } catch (e) {
    log.warn("update_bin_failed", { binId, error: String(e) });
    return { ok: false, error: errMessage(e) };
  }
}

export async function deleteBinAction(binId: string): Promise<Result<unknown>> {
  try {
    const { shopId } = await ctx();
    await runWithTenantAsync(shopId, () => deleteBin(shopId, binId));
    revalidatePath("/admin/lagerplaetze");
    return { ok: true };
  } catch (e) {
    log.warn("delete_bin_failed", { binId, error: String(e) });
    return { ok: false, error: errMessage(e) };
  }
}

export async function listAssignableVariantsAction(): Promise<
  Result<{ variants: AssignableVariant[] }>
> {
  try {
    const { shopId } = await ctx();
    const variants = await runWithTenantAsync(shopId, () =>
      listVariantsWithBins(shopId),
    );
    return { ok: true, variants };
  } catch (e) {
    return { ok: false, error: errMessage(e) };
  }
}

export async function assignVariantAction(
  variantId: string,
  binId: string | null,
): Promise<Result<unknown>> {
  try {
    const { shopId, user } = await ctx();
    await runWithTenantAsync(shopId, () =>
      assignVariantToBin(shopId, variantId, binId, user.uid),
    );
    revalidatePath("/admin/lagerplaetze");
    return { ok: true };
  } catch (e) {
    log.warn("assign_variant_bin_failed", { variantId, binId, error: String(e) });
    return { ok: false, error: errMessage(e) };
  }
}
