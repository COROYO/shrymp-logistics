import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { buildLagerbestandCsv } from "@/server/inventory/lagerbestand-csv";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    // `?charges=0` exportiert nur Produktzeilen (ohne Chargen).
    const includeBatches =
      new URL(req.url).searchParams.get("charges") !== "0";
    const csv = await buildLagerbestandCsv({ includeBatches });
    const stamp = new Date().toISOString().slice(0, 10);
    const suffix = includeBatches ? "" : "-ohne-chargen";
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="lagerbestand${suffix}-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("lagerbestand_export_failed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
