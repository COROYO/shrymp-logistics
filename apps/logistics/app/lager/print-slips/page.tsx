import { parseOrderIds } from "@/lib/print-slips-ids";
import { BulkPrintClient } from "./bulk-print";

export const dynamic = "force-dynamic";

/**
 * Bulk packing-slip print page.
 *
 * IDs arrive as:
 *   - `?job=<id>` — short URL, ids stored in a Firestore print job
 *   - `?ids=1,2,3` — legacy / small Shopify GET links
 *   - `#ids=1,2,3` — Shopify workaround when the query string would be too long
 *     (the hash is never sent to the server)
 *
 * Slips are generated in sequential HTTP chunks so a large batch cannot
 * time out Hosting.
 */
export default async function BulkPrintSlipsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; job?: string }>;
}) {
  const { ids, job } = await searchParams;
  const jobId = job?.trim() || undefined;
  const initialIds = parseOrderIds(ids ?? "");

  return <BulkPrintClient jobId={jobId} initialIds={initialIds} />;
}
