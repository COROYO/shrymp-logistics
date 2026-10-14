/** Uploaded packing-slip QR image. Stored in Firebase Storage, printed inline. */

export const SLIP_QR_MAX_BYTES = 512 * 1024;

export const SLIP_QR_FORMATS = ["png", "jpeg", "webp"] as const;

export type SlipQrFormat = (typeof SLIP_QR_FORMATS)[number];

const MIME: Record<SlipQrFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function slipQrMime(format: SlipQrFormat): string {
  return MIME[format];
}

/** Detect a PNG, JPEG, or WebP from magic bytes. Anything else is rejected. */
export function detectSlipQrFormat(bytes: Uint8Array): SlipQrFormat | null {
  if (bytes.length < 12 || bytes.length > SLIP_QR_MAX_BYTES) return null;
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}
