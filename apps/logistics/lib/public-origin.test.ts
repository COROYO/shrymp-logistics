import { afterEach, describe, expect, it } from "vitest";
import { publicOrigin } from "./public-origin";

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("publicOrigin", () => {
  afterEach(() => {
    delete process.env.APP_BASE_URL;
  });

  it("uses APP_BASE_URL when the request origin is the Cloud Run bind address", () => {
    process.env.APP_BASE_URL = "https://lager.shrymp.de/";
    expect(
      publicOrigin(req("https://0.0.0.0:8080/api/shopify/install?shop=x")),
    ).toBe("https://lager.shrymp.de");
  });

  it("adds https when APP_BASE_URL has no scheme", () => {
    process.env.APP_BASE_URL = "lager.shrymp.de";
    expect(publicOrigin(req("https://0.0.0.0:8080/api/shopify/callback"))).toBe(
      "https://lager.shrymp.de",
    );
  });

  it("falls back to the forwarded host and skips 0.0.0.0", () => {
    expect(
      publicOrigin(
        req("https://0.0.0.0:8080/api/shopify/callback", {
          host: "0.0.0.0:8080",
          "x-forwarded-host": "lager.shrymp.de",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://lager.shrymp.de");
  });
});
