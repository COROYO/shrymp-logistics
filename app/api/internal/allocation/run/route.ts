import { headers } from "next/headers";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { log } from "@/lib/logger";
import { runAllocationInFirestore } from "@/server/allocation/run";

/**
 * Cloud Tasks → this endpoint, called with an OIDC token signed for
 * `ALLOCATION_TARGET_URL` audience. We verify the token and run the
 * allocation.
 *
 * In local dev (no OIDC), bypass verification when
 * `ALLOCATION_ALLOW_UNAUTHENTICATED=1`.
 */

const Body = z.object({
  triggeredBy: z.enum([
    "ORDER_CREATED",
    "ORDER_UPDATED",
    "ORDER_CANCELLED",
    "INBOUND",
    "PACKING_DONE",
    "MANUAL",
  ]),
  triggerEventId: z.string().optional(),
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
  const expectedAudience = process.env.ALLOCATION_TARGET_URL;

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
      log.warn("allocation_run_unauthorized", { reason: v.reason });
      return new Response("unauthorized", { status: 401 });
    }
  }

  let body;
  try {
    body = Body.parse(await req.json());
  } catch {
    return new Response("invalid_body", { status: 400 });
  }

  try {
    const result = await runAllocationInFirestore({
      triggeredBy: body.triggeredBy,
      triggerEventId: body.triggerEventId,
    });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    log.error("allocation_run_endpoint_error", { error: String(e) });
    return new Response("run_failed", { status: 500 });
  }
}
