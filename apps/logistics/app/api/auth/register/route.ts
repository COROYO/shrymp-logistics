import { NextResponse } from "next/server";
import { z } from "zod";
import { createMerchantAccount } from "@/lib/auth/bootstrap";
import { normalizeShopDomainInput } from "@/server/tenant/id";
import { clientIp, rateLimit } from "@/server/security/rate-limit";
import { log } from "@/lib/logger";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Passwort min. 8 Zeichen"),
  displayName: z.string().max(80).optional(),
  shopDomain: z.string().max(120).optional(),
});

/**
 * POST /api/auth/register
 *
 * Public merchant self-registration. Creates an ADMIN account without shop
 * access until Shopify OAuth completes.
 */
export async function POST(req: Request) {
  // Throttle abuse: max 5 registrations per IP per hour.
  const ip = clientIp(req);
  const limited = await rateLimit(`register:${ip}`, {
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429 },
    );
  }

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError
        ? e.issues.map((i) => i.message).join("; ")
        : "invalid_body";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  let pendingShopDomain: string | undefined;
  if (body.shopDomain?.trim()) {
    const normalized = normalizeShopDomainInput(body.shopDomain);
    if (!normalized) {
      return NextResponse.json(
        { ok: false, error: "invalid_shop_domain" },
        { status: 400 },
      );
    }
    pendingShopDomain = normalized;
  }

  try {
    await createMerchantAccount({
      email: body.email,
      password: body.password,
      displayName: body.displayName,
      pendingShopDomain,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("merchant_register_failed", { error: msg });
    // Surface only the email-conflict case to the client; mask everything else.
    if (msg.includes("email-already-exists")) {
      return NextResponse.json(
        { ok: false, error: "email-already-exists" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "registration_failed" },
      { status: 500 },
    );
  }
}
