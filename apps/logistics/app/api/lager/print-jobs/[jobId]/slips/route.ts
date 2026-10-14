import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { PRINT_SLIP_CHUNK_SIZE } from "@/lib/print-slip-chunk";
import { generatePrintJobSlipChunk } from "@/server/picking/print-job-slips";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Generate the next packing-slip chunk for a print job.
 *
 * One request, sequential Charge assignment, small slice — so large
 * batches complete without URL truncation or Hosting timeouts.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const user = await getSessionUser();
  if (!user || (user.role !== "LAGER" && user.role !== "ADMIN")) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }

  const { jobId } = await ctx.params;
  let offset = 0;
  let limit = PRINT_SLIP_CHUNK_SIZE;
  try {
    const body = (await req.json()) as { offset?: unknown; limit?: unknown };
    if (typeof body.offset === "number" && Number.isFinite(body.offset)) {
      offset = body.offset;
    }
    if (typeof body.limit === "number" && Number.isFinite(body.limit)) {
      limit = body.limit;
    }
  } catch {
    // empty body → first chunk
  }

  const chunk = await generatePrintJobSlipChunk(jobId, offset, limit);
  if (!chunk) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(chunk);
}
