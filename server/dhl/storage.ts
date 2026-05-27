import "server-only";
import { getStorage } from "firebase-admin/storage";

/**
 * Firebase Storage helpers for DHL label PDFs.
 *
 * Layout: `gs://<bucket>/dhl-labels/{orderId}/{shipmentNo}.pdf`
 *
 * The default Firebase project bucket is used (configured via
 * `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`). We hand out v4-signed URLs so the
 * browser can download the PDF without going through our Next.js server.
 */

const SIGNED_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function bucketName(): string {
  const explicit = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (explicit) return explicit;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID required for storage");
  return `${projectId}.firebasestorage.app`;
}

export type StoredLabel = {
  storagePath: string;
  signedUrl: string;
  expiresAt: Date;
};

export async function uploadLabelPdf(
  orderId: string,
  shipmentNo: string,
  pdf: Buffer,
): Promise<StoredLabel> {
  const storage = getStorage();
  const bucket = storage.bucket(bucketName());
  const storagePath = `dhl-labels/${orderId}/${shipmentNo}.pdf`;
  const file = bucket.file(storagePath);
  await file.save(pdf, {
    contentType: "application/pdf",
    resumable: false,
    metadata: {
      cacheControl: "private, max-age=3600",
      customMetadata: { orderId, shipmentNo },
    },
  });
  return signLabel(orderId, shipmentNo);
}

export async function signLabel(
  orderId: string,
  shipmentNo: string,
): Promise<StoredLabel> {
  const storage = getStorage();
  const bucket = storage.bucket(bucketName());
  const storagePath = `dhl-labels/${orderId}/${shipmentNo}.pdf`;
  const file = bucket.file(storagePath);
  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_MS);
  const [signedUrl] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: expiresAt,
  });
  return { storagePath, signedUrl, expiresAt };
}
