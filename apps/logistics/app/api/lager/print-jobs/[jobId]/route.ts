import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { loadPrintJob } from "@/server/picking/print-jobs";

export const dynamic = "force-dynamic";

/**
 * Read a print job's order ids. Client uses this to show X/Y immediately
 * and to isolate poison orders when a chunk request fails.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const user = await getSessionUser();
  if (!user || (user.role !== "LAGER" && user.role !== "ADMIN")) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }

  const { jobId } = await ctx.params;
  const job = await loadPrintJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.id,
    orderIds: job.order_ids,
    total: job.order_ids.length,
  });
}
