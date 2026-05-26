import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { isValidShopDomain, verifyInstallHmac } from "./auth";

const SECRET = "client-secret-xyz";

function signedParams(extra: Record<string, string>): URLSearchParams {
  const sp = new URLSearchParams(extra);
  const sorted: [string, string][] = [];
  for (const [k, v] of sp.entries()) {
    if (k !== "hmac") sorted.push([k, v]);
  }
  sorted.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const message = sorted.map(([k, v]) => `${k}=${v}`).join("&");
  const hmac = createHmac("sha256", SECRET).update(message).digest("hex");
  sp.set("hmac", hmac);
  return sp;
}

describe("isValidShopDomain", () => {
  it("accepts standard *.myshopify.com domains", () => {
    expect(isValidShopDomain("monolithcaviar.myshopify.com")).toBe(true);
    expect(isValidShopDomain("foo-bar-1.myshopify.com")).toBe(true);
  });
  it("rejects other domains and obvious abuses", () => {
    expect(isValidShopDomain("example.com")).toBe(false);
    expect(isValidShopDomain("evil.myshopify.com.evil.com")).toBe(false);
    expect(isValidShopDomain("./.myshopify.com")).toBe(false);
    expect(isValidShopDomain("")).toBe(false);
    expect(isValidShopDomain(null)).toBe(false);
  });
});

describe("verifyInstallHmac", () => {
  it("accepts a valid signed URL parameter set", () => {
    const sp = signedParams({
      shop: "monolithcaviar.myshopify.com",
      code: "abc",
      state: "xyz",
      timestamp: "1700000000",
    });
    expect(verifyInstallHmac(sp, SECRET)).toBe(true);
  });

  it("rejects when any field is tampered", () => {
    const sp = signedParams({
      shop: "monolithcaviar.myshopify.com",
      code: "abc",
      state: "xyz",
    });
    sp.set("code", "tampered");
    expect(verifyInstallHmac(sp, SECRET)).toBe(false);
  });

  it("rejects with wrong secret", () => {
    const sp = signedParams({
      shop: "monolithcaviar.myshopify.com",
      code: "abc",
      state: "xyz",
    });
    expect(verifyInstallHmac(sp, "other")).toBe(false);
  });

  it("rejects when hmac is missing", () => {
    const sp = new URLSearchParams({ shop: "x.myshopify.com" });
    expect(verifyInstallHmac(sp, SECRET)).toBe(false);
  });
});
