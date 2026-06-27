"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import { SlipBrandingSchema } from "@/server/firestore/schema";
import { updateShopSlipBranding } from "@/server/tenant/shop";
import { log } from "@/lib/logger";

const InputSchema = SlipBrandingSchema.omit({
  updated_at: true,
  updated_by_uid: true,
});

export type SaveSlipBrandingResult =
  | { ok: true }
  | { ok: false; error: string; details?: unknown };

export async function saveSlipBrandingAction(
  formData: FormData,
): Promise<SaveSlipBrandingResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = InputSchema.safeParse({
    brand_name: formData.get("brand_name"),
    eyebrow: formData.get("eyebrow"),
    company_line: formData.get("company_line"),
    contact_email: formData.get("contact_email"),
    accent_color: formData.get("accent_color"),
    header_color: formData.get("header_color"),
    document_title: formData.get("document_title"),
    signature: formData.get("signature"),
    footer_legal: formData.get("footer_legal"),
  });
  if (!parsed.success) {
    return { ok: false, error: "validation", details: parsed.error.flatten() };
  }

  const shopId = await requireActiveShopId(user);
  await updateShopSlipBranding(shopId, parsed.data, user.uid);

  log.info("slip_branding_saved", { uid: user.uid, shopId });
  revalidatePath("/admin/settings");
  revalidatePath("/lager/picking", "layout");
  return { ok: true };
}
