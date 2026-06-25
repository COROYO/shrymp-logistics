"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import { DhlConfigSchema } from "@/server/firestore/schema";
import { updateShopDhlConfig } from "@/server/tenant/shop";
import { log } from "@/lib/logger";

const InputSchema = z.object({
  billing_number: z.string().trim().regex(/^.{14}$/, "exact 14 chars"),
  profile: z.string().trim().min(1).max(35).default("STANDARD_GRUPPENPROFIL"),
  shipper: z.object({
    name1: z.string().trim().min(1).max(50),
    name2: z.string().trim().max(50).nullable().optional(),
    addressStreet: z.string().trim().min(1).max(50),
    addressHouse: z.string().trim().max(10).nullable().optional(),
    postalCode: z.string().trim().min(3).max(10),
    city: z.string().trim().min(1).max(40),
    country: z
      .string()
      .trim()
      .length(3)
      .transform((s) => s.toUpperCase()),
    email: z.string().trim().email().nullable().optional(),
    phone: z.string().trim().max(20).nullable().optional(),
  }),
  default_weight_g: z.coerce.number().int().positive().max(31500),
  default_dimensions_mm: z
    .object({
      length: z.coerce.number().int().positive(),
      width: z.coerce.number().int().positive(),
      height: z.coerce.number().int().positive(),
    })
    .optional(),
  gkp_username: z.string().trim().min(1).nullable().optional(),
  gkp_password: z.string().min(1).nullable().optional(),
  cod_account_reference: z.string().trim().max(35).nullable().optional(),
  sandbox: z.boolean(),
});

export type SaveDhlConfigResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

export async function saveDhlConfigAction(
  formData: FormData,
): Promise<SaveDhlConfigResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const raw = {
    billing_number: formData.get("billing_number"),
    profile: formData.get("profile") || "STANDARD_GRUPPENPROFIL",
    shipper: {
      name1: formData.get("shipper_name1"),
      name2: emptyToNull(formData.get("shipper_name2")),
      addressStreet: formData.get("shipper_addressStreet"),
      addressHouse: emptyToNull(formData.get("shipper_addressHouse")),
      postalCode: formData.get("shipper_postalCode"),
      city: formData.get("shipper_city"),
      country: formData.get("shipper_country") || "DEU",
      email: emptyToNull(formData.get("shipper_email")),
      phone: emptyToNull(formData.get("shipper_phone")),
    },
    default_weight_g: formData.get("default_weight_g") ?? "1000",
    default_dimensions_mm: undefined as
      | undefined
      | { length: unknown; width: unknown; height: unknown },
    gkp_username: emptyToNull(formData.get("gkp_username")),
    gkp_password: emptyToNull(formData.get("gkp_password")),
    cod_account_reference: emptyToNull(formData.get("cod_account_reference")),
    sandbox: formData.get("sandbox") === "on",
  };
  const dimL = formData.get("dim_length");
  const dimW = formData.get("dim_width");
  const dimH = formData.get("dim_height");
  if (dimL && dimW && dimH) {
    raw.default_dimensions_mm = { length: dimL, width: dimW, height: dimH };
  }

  const parsed = InputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid_input",
      details: parsed.error.flatten(),
    };
  }

  const data = parsed.data;

  // When user leaves the password field empty during edit, keep the
  // previously stored value (don't overwrite with null).
  let prevPassword: string | null = null;
  try {
    const shopId = await requireActiveShopId(user);
    const { getShop } = await import("@/server/tenant/shop");
    const shop = await getShop(shopId);
    prevPassword = shop?.dhl_config?.gkp_password ?? null;
  } catch {
    // ignore — first-time write
  }
  const effectivePassword = data.gkp_password ?? prevPassword;

  const docPayload = DhlConfigSchema.parse({
    ...data,
    gkp_password: effectivePassword,
    updated_at: new Date(),
    updated_by_uid: user.uid,
  });

  const shopId = await requireActiveShopId(user);
  await updateShopDhlConfig(shopId, docPayload);

  log.info("dhl_config_saved", {
    uid: user.uid,
    sandbox: docPayload.sandbox,
    billing_number_set: !!docPayload.billing_number,
  });

  revalidatePath("/admin/settings");
  return { ok: true };
}

function emptyToNull(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = typeof v === "string" ? v.trim() : "";
  return s.length === 0 ? null : s;
}
