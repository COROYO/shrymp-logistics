import { afterEach, describe, expect, it } from "vitest";
import { WEBHOOK_TASK_MAX_RAW_CHARS } from "./webhook-task";
import { enqueueShopifyWebhook } from "./enqueue-webhook";

describe("enqueueShopifyWebhook", () => {
  const previous = process.env.INPROCESS_JOBS;

  afterEach(() => {
    if (previous === undefined) delete process.env.INPROCESS_JOBS;
    else process.env.INPROCESS_JOBS = previous;
  });

  it("does not call Cloud Tasks when in-process jobs are off", async () => {
    delete process.env.INPROCESS_JOBS;
    const result = await enqueueShopifyWebhook({
      rawBody: "{}",
      topic: "orders/create",
      webhookId: "wh-1",
      shop: "demo.myshopify.com",
    });
    expect(result).toBe("unavailable");
  });

  it("refuses a payload that would not fit a queue body", async () => {
    process.env.INPROCESS_JOBS = "1";
    const result = await enqueueShopifyWebhook({
      rawBody: "x".repeat(WEBHOOK_TASK_MAX_RAW_CHARS + 1),
      topic: "orders/create",
      webhookId: "wh-2",
      shop: "demo.myshopify.com",
    });
    expect(result).toBe("unavailable");
  });
});
