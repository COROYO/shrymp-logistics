import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyShopifyHmac } from "./hmac";

const SECRET = "test-secret-xyz";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

describe("verifyShopifyHmac", () => {
  it("accepts a valid signature", () => {
    const body = '{"id":1}';
    const sig = sign(body);
    expect(verifyShopifyHmac(body, sig, SECRET)).toBe(true);
  });

  it("rejects when body is tampered", () => {
    const sig = sign('{"id":1}');
    expect(verifyShopifyHmac('{"id":2}', sig, SECRET)).toBe(false);
  });

  it("rejects when the signature uses a different secret", () => {
    const body = '{"id":1}';
    const sig = sign(body, "other-secret");
    expect(verifyShopifyHmac(body, sig, SECRET)).toBe(false);
  });

  it("rejects a missing or empty signature", () => {
    expect(verifyShopifyHmac("body", null, SECRET)).toBe(false);
    expect(verifyShopifyHmac("body", "", SECRET)).toBe(false);
  });

  it("rejects garbage non-base64 input", () => {
    // Buffer.from('not!!base64', 'base64') silently produces bytes, so the
    // length check catches it.
    expect(verifyShopifyHmac("body", "🟥🟦🟦", SECRET)).toBe(false);
  });

  it("rejects when secret is empty", () => {
    const body = '{"id":1}';
    const sig = sign(body);
    expect(verifyShopifyHmac(body, sig, "")).toBe(false);
  });
});
