import { NextResponse } from "next/server";
import { z } from "zod";
import { createFirstAdmin, hasAnyAdmin } from "@/lib/auth/bootstrap";
import { log } from "@/lib/logger";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Passwort min. 8 Zeichen"),
  displayName: z.string().max(80).optional(),
});

/**
 * POST /api/setup/bootstrap-admin
 *
 * Public (unauthenticated) endpoint to create the very first ADMIN account.
 * Refuses once any ADMIN already exists.
 */
export async function POST(req: Request) {
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

  try {
    if (await hasAnyAdmin()) {
      return NextResponse.json(
        { ok: false, error: "admin_already_exists" },
        { status: 409 },
      );
    }
  } catch (e) {
    log.error("hasAnyAdmin_check_failed", { error: String(e) });
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  try {
    const { uid } = await createFirstAdmin(body);
    return NextResponse.json({ ok: true, uid });
  } catch (e) {
    log.error("create_first_admin_failed", { error: String(e) });
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
