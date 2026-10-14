import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { parseOrderIds } from "@/lib/print-slips-ids";
import { createPrintJob } from "@/server/picking/print-jobs";

/**
 * Create a short-lived print job and redirect to `/lager/print-slips?job=…`.
 *
 * Form POST (from the picking/packed tables) → 303 redirect in a new tab.
 * JSON POST (Shopify Flow / scripts) → `{ jobId, url }`.
 *
 * This keeps bulk-print URLs short: the order ids live in Firestore, not
 * in a query string that Shopify or a proxy will truncate.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "LAGER" && user.role !== "ADMIN")) {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return NextResponse.json({ error: "forbidden" }, { status: 401 });
    }
    const login = new URL("/login", req.url);
    login.searchParams.set("next", "/lager/print-slips");
    return NextResponse.redirect(login);
  }

  const contentType = req.headers.get("content-type") ?? "";
  let rawIds: string | string[] = "";

  if (contentType.includes("application/json")) {
    try {
      const body = (await req.json()) as { ids?: unknown };
      if (Array.isArray(body.ids)) {
        rawIds = body.ids.map((v) => String(v));
      } else if (typeof body.ids === "string") {
        rawIds = body.ids;
      }
    } catch {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
  } else {
    const form = await req.formData();
    rawIds = String(form.get("ids") ?? "");
  }

  const ids = parseOrderIds(rawIds);
  if (ids.length === 0) {
    return NextResponse.json({ error: "empty" }, { status: 400 });
  }

  const job = await createPrintJob(ids, user.uid);
  const url = `/lager/print-slips?job=${encodeURIComponent(job.id)}`;

  if (contentType.includes("application/json")) {
    return NextResponse.json({ jobId: job.id, url });
  }

  return NextResponse.redirect(new URL(url, req.url), 303);
}
