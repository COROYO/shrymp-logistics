"use server";

import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import {
  PRODUCT_IMAGE_ALLOWED_MIME,
  PRODUCT_IMAGE_MAX_BYTES,
  uploadProductImageToShopify,
} from "@/server/shopify/staged-upload";
import { log } from "@/lib/logger";

export type UploadProductMediaResult =
  | { ok: true; url: string }
  | { ok: false; error: string; code?: string };

export async function uploadProductMediaAction(
  formData: FormData,
): Promise<UploadProductMediaResult> {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "no_file" };
  }
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
    return { ok: false, error: "file_too_large", code: "file_too_large" };
  }
  if (!PRODUCT_IMAGE_ALLOWED_MIME.has(file.type)) {
    return { ok: false, error: "unsupported_type", code: "unsupported_type" };
  }

  try {
    const shopId = await requireActiveShopId(user);
    const buffer = Buffer.from(await file.arrayBuffer());
    const { resourceUrl } = await uploadProductImageToShopify(shopId, {
      buffer,
      filename: file.name.replace(/[^\w.\-()+]/g, "_") || "upload.jpg",
      mimeType: file.type,
    });
    log.info("product_media_uploaded", {
      shopId,
      bytes: buffer.byteLength,
      mimeType: file.type,
    });
    return { ok: true, url: resourceUrl };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/write_products|access scope|access denied/i.test(msg)) {
      return { ok: false, error: "missing_scope", code: "missing_scope" };
    }
    log.warn("product_media_upload_failed", { error: msg });
    return { ok: false, error: msg };
  }
}
