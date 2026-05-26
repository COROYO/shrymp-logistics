import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Shopify webhook HMAC signature.
 *
 * @param rawBody The exact raw request body bytes (do NOT JSON.parse first).
 * @param signatureBase64 Value of the `X-Shopify-Hmac-Sha256` header.
 * @param secret The shared secret configured in Shopify (API secret for
 *   public apps, or webhook signing key for custom apps).
 */
export function verifyShopifyHmac(
  rawBody: string,
  signatureBase64: string | null,
  secret: string,
): boolean {
  if (!signatureBase64 || !secret) return false;

  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(signatureBase64, "base64");
  } catch {
    return false;
  }

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(expected, provided);
}
