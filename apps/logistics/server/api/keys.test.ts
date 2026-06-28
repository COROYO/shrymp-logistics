import { describe, expect, it } from "vitest";
import {
  generateApiKeyRaw,
  hashApiKey,
  isApiKeyToken,
} from "@/server/api/keys";

describe("api keys", () => {
  it("generates sk_live prefix tokens", () => {
    const raw = generateApiKeyRaw();
    expect(raw.startsWith("sk_live_")).toBe(true);
    expect(isApiKeyToken(raw)).toBe(true);
    expect(isApiKeyToken("session-cookie")).toBe(false);
  });

  it("hashes deterministically", () => {
    const raw = "sk_live_test";
    expect(hashApiKey(raw)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashApiKey(raw)).toBe(hashApiKey(raw));
  });
});
