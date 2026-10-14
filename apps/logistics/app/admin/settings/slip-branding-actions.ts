"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import { SLIP_LAYOUT_FLAG_KEYS } from "@/lib/slip/defaults";
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

  const layoutFlags = Object.fromEntries(
    SLIP_LAYOUT_FLAG_KEYS.map((key) => [key, formData.get(key) === "1"]),
  );
  const parsed = InputSchema.safeParse({
    brand_name: formData.get("brand_name"),
    eyebrow: String(formData.get("eyebrow") ?? "").trim(),
    company_line: formData.get("company_line"),
    contact_email: String(formData.get("contact_email") ?? "").trim(),
    accent_color: formData.get("accent_color"),
    header_color: formData.get("header_color"),
    document_title: formData.get("document_title"),
    signature: formData.get("signature"),
    footer_legal: formData.get("footer_legal"),
    title_size_pt: Number(formData.get("title_size_pt")),
    sku_size_pt: Number(formData.get("sku_size_pt")),
    ...layoutFlags,
  });
  if (!parsed.success) {
    return { ok: false, error: "validation", details: parsed.error.flatten() };
  }

  const shopId = await requireActiveShopId(user);
  await updateShopSlipBranding(shopId, parsed.data, user.uid);

  log.info("slip_branding_saved", { uid: user.uid, shopId });
  revalidatePath("/admin/settings");
  revalidatePath("/admin/settings/lieferschein");
  revalidatePath("/lager/picking", "layout");
  return { ok: true };
}
