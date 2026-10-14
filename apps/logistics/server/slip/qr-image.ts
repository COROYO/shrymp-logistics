import "server-only";
import { getStorage } from "firebase-admin/storage";
import { adminDb, resolveFirebaseProjectId } from "@/server/firestore/admin";
import { log } from "@/lib/logger";
import {
  detectSlipQrFormat,
  SLIP_QR_FORMATS,
  SLIP_QR_MAX_BYTES,
  slipQrMime,
  type SlipQrFormat,
} from "@/lib/slip/qr-image";

function bucketName(): string {
  const explicit = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (explicit) return explicit;
  const projectId = resolveFirebaseProjectId();
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID required for storage");
  return `${projectId}.firebasestorage.app`;
}

function qrPath(shopId: string, format: SlipQrFormat): string {
  return `slip-qr/${shopId}.${format}`;
}

function bucket() {
  adminDb();
  return getStorage().bucket(bucketName());
}

export async function storeSlipQrImage(
  shopId: string,
  file: File,
): Promise<{ ok: true; format: SlipQrFormat } | { ok: false; error: string }> {
  if (file.size > SLIP_QR_MAX_BYTES) {
    return { ok: false, error: "Der QR-Code darf höchstens 500 KB groß sein." };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = detectSlipQrFormat(bytes);
  if (!format) {
    return {
      ok: false,
      error: "Bitte ein PNG-, JPEG- oder WebP-Bild hochladen.",
    };
  }

  const storagePath = qrPath(shopId, format);
  await bucket().file(storagePath).save(Buffer.from(bytes), {
    contentType: slipQrMime(format),
    resumable: false,
    metadata: { cacheControl: "private, max-age=3600" },
  });

  await Promise.all(
    SLIP_QR_FORMATS.filter((other) => other !== format).map((other) =>
      bucket()
        .file(qrPath(shopId, other))
        .delete({ ignoreNotFound: true }),
    ),
  );

  log.info("slip_qr_uploaded", { shopId, format, bytes: bytes.length });
  return { ok: true, format };
}

export async function deleteSlipQrImages(shopId: string): Promise<void> {
  await Promise.all(
    SLIP_QR_FORMATS.map((format) =>
      bucket()
        .file(qrPath(shopId, format))
        .delete({ ignoreNotFound: true }),
    ),
  );
}

/** Data URL for print and the settings preview. Missing files render as no QR. */
export async function loadSlipQrDataUrl(
  shopId: string,
  format: SlipQrFormat | null,
): Promise<string | null> {
  if (!format) return null;
  try {
    const file = bucket().file(qrPath(shopId, format));
    const [exists] = await file.exists();
    if (!exists) return null;
    const [buf] = await file.download();
    return `data:${slipQrMime(format)};base64,${buf.toString("base64")}`;
  } catch (e) {
    log.warn("slip_qr_load_failed", {
      shopId,
      format,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
