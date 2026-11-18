import { headers } from "next/headers";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { log } from "@/lib/logger";
import { processShopifyWebhookEvent } from "@/server/shopify/process-webhook-event";
import { isSupportedTopic } from "@/server/shopify/topics";
import { shopifyWebhookConsumerUrl } from "@/server/shopify/webhook-task";

/**
 * Cloud Tasks consumer for a verified Shopify webhook.
 * OIDC audience is the consumer URL, same service account as allocation.
 * Local dev sets `ALLOCATION_ALLOW_UNAUTHENTICATED=1`.
 *
 * Infrastructure failures return 500 so the queue retries. A recorded
 * application error returns 200 — retrying a bad payload will not fix it.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  shop: z.string().min(1),
  topic: z.string().min(1),
  webhookId: z.string().min(1),
  rawBody: z.string(),
});

const oauthClient = new OAuth2Client();

async function verifyOidc(
  authHeader: string | null,
  expectedAudience: string,
  expectedEmails: string[],
): Promise<{ ok: boolean; reason?: string }> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, reason: "no_bearer" };
  }
  const token = authHeader.slice("Bearer ".length);
  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken: token,
      audience: expectedAudience,
    });
    const payload = ticket.getPayload();
    if (!payload) return { ok: false, reason: "no_payload" };
    if (
      expectedEmails.length > 0 &&
      payload.email &&
      !expectedEmails.includes(payload.email)
    ) {
      return { ok: false, reason: "email_mismatch" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

export async function POST(req: Request) {
  const h = await headers();
  const expectedAudience = shopifyWebhookConsumerUrl();

  if (process.env.ALLOCATION_ALLOW_UNAUTHENTICATED !== "1") {
    if (!expectedAudience) {
      return new Response("misconfigured", { status: 500 });
    }
    const expectedEmails = (process.env.ALLOCATION_INVOKER_SERVICE_ACCOUNT ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const v = await verifyOidc(
      h.get("authorization"),
      expectedAudience,
      expectedEmails,
    );
    if (!v.ok) {
      log.warn("shopify_webhook_consumer_unauthorized", { reason: v.reason });
      return new Response("unauthorized", { status: 401 });
    }
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return new Response("invalid_body", { status: 400 });
  }

  if (!isSupportedTopic(body.topic)) {
    log.info("shopify_webhook_unsupported_topic", {
      topic: body.topic,
      webhookId: body.webhookId,
    });
    return new Response("unsupported topic", { status: 200 });
  }

  const outcome = await processShopifyWebhookEvent({
    rawBody: body.rawBody,
    topic: body.topic,
    webhookId: body.webhookId,
    shop: body.shop,
    reprocessIncomplete: true,
  });

  if (outcome === "retry") {
    return new Response("retry", { status: 500 });
  }
  return new Response("ok", { status: 200 });
}
