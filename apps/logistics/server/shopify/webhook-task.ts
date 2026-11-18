/** Cloud Tasks task ids: letters, numbers, underscores, hyphens, max 500. */
const TASK_ID = /^[A-Za-z0-9_-]{1,500}$/;

/**
 * Cloud Tasks rejects HTTP bodies over 1 MiB. Base64 plus the JSON envelope
 * expands the raw webhook, so the raw payload itself stays well under that.
 */
export const WEBHOOK_TASK_MAX_RAW_CHARS = 700_000;

export function shopifyWebhookTaskId(webhookId: string): string | null {
  const safe = webhookId.replace(/[^A-Za-z0-9_-]/g, "");
  if (!safe) return null;
  const id = `wh-${safe}`;
  if (!TASK_ID.test(id)) return null;
  return id;
}

export function webhookBodyFitsTask(rawBody: string): boolean {
  return rawBody.length <= WEBHOOK_TASK_MAX_RAW_CHARS;
}

/** Audience for the OIDC token and the URL Cloud Tasks posts to. */
export function shopifyWebhookConsumerUrl(): string | null {
  const explicit = process.env.SHOPIFY_WEBHOOK_TARGET_URL?.trim();
  if (explicit) return explicit;
  const base = process.env.APP_BASE_URL?.trim();
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/api/internal/shopify/webhook`;
}
