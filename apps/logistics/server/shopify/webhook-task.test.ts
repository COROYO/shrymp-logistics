import { describe, expect, it } from "vitest";
import {
  WEBHOOK_TASK_MAX_RAW_CHARS,
  shopifyWebhookConsumerUrl,
  shopifyWebhookTaskId,
  webhookBodyFitsTask,
} from "./webhook-task";

describe("shopify webhook task", () => {
  it("builds a Cloud Tasks id from a Shopify webhook id", () => {
    expect(shopifyWebhookTaskId("c3bd70ee-6ece-5580-8b8f-e97b6532538f")).toBe(
      "wh-c3bd70ee-6ece-5580-8b8f-e97b6532538f",
    );
  });

  it("strips characters Cloud Tasks rejects", () => {
    expect(shopifyWebhookTaskId("id/with space")).toBe("wh-idwithspace");
  });

  it("rejects an empty id", () => {
    expect(shopifyWebhookTaskId("")).toBeNull();
    expect(shopifyWebhookTaskId("///")).toBeNull();
  });

  it("refuses payloads that would exceed the Cloud Tasks body limit", () => {
    expect(webhookBodyFitsTask("ok")).toBe(true);
    expect(webhookBodyFitsTask("x".repeat(WEBHOOK_TASK_MAX_RAW_CHARS + 1))).toBe(
      false,
    );
  });

  it("derives the consumer URL from APP_BASE_URL", () => {
    const previous = process.env.APP_BASE_URL;
    const explicit = process.env.SHOPIFY_WEBHOOK_TARGET_URL;
    delete process.env.SHOPIFY_WEBHOOK_TARGET_URL;
    process.env.APP_BASE_URL = "https://lager.shrymp.de/";
    expect(shopifyWebhookConsumerUrl()).toBe(
      "https://lager.shrymp.de/api/internal/shopify/webhook",
    );
    process.env.SHOPIFY_WEBHOOK_TARGET_URL =
      "https://lager.shrymp.de/custom";
    expect(shopifyWebhookConsumerUrl()).toBe("https://lager.shrymp.de/custom");
    if (previous === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previous;
    if (explicit === undefined) delete process.env.SHOPIFY_WEBHOOK_TARGET_URL;
    else process.env.SHOPIFY_WEBHOOK_TARGET_URL = explicit;
  });
});
