import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { classifyWebhookHmac } from "./webhook-auth";

const ENV = "env-secret-value";
const STORED = "shop-secret-value";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

describe("classifyWebhookHmac", () => {
  const body = '{"id":1}';

  it("accepts the env secret without needing the stored one", () => {
    expect(
      classifyWebhookHmac({
        rawBody: body,
        signature: sign(body, ENV),
        envSecret: ENV,
        storedSecret: undefined,
      }),
    ).toBe("ok");
  });

  it("asks for the per-shop secret when the env secret does not match", () => {
    expect(
      classifyWebhookHmac({
        rawBody: body,
        signature: sign(body, STORED),
        envSecret: ENV,
        storedSecret: undefined,
      }),
    ).toBe("need_stored");
  });

  it("accepts the stored secret after the env secret missed", () => {
    expect(
      classifyWebhookHmac({
        rawBody: body,
        signature: sign(body, STORED),
        envSecret: ENV,
        storedSecret: STORED,
      }),
    ).toBe("ok");
  });

  it("rejects when neither secret matches", () => {
    expect(
      classifyWebhookHmac({
        rawBody: body,
        signature: sign(body, "other-secret"),
        envSecret: ENV,
        storedSecret: STORED,
      }),
    ).toBe("invalid");
  });

  it("reports misconfigured when no secret exists", () => {
    expect(
      classifyWebhookHmac({
        rawBody: body,
        signature: sign(body, ENV),
        envSecret: null,
        storedSecret: null,
      }),
    ).toBe("misconfigured");
  });
});
