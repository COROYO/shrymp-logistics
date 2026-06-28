import { notFound, redirect } from "next/navigation";
import { adminDb } from "@/server/firestore/admin";
import { Collections, type Order } from "@/server/firestore/schema";
import { assertShopAccessibleForPage } from "@/lib/auth/tenant-page";
import { loadPickRun } from "@/server/picking/pick-runs";
import { RunPackClient, type RunPackRow } from "./run-pack-client";

export const dynamic = "force-dynamic";

export default async function RunPackPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const run = await loadPickRun(runId);
  if (!run) notFound();
  await assertShopAccessibleForPage(run.shop_id, `/lager/run/${runId}/pack`);
  if (run.status === "PICKING") redirect(`/lager/run/${runId}`);

  const db = adminDb();
  const snaps =
    run.order_ids.length > 0
      ? await db.getAll(
          ...run.order_ids.map((id) =>
            db.collection(Collections.Orders).doc(id),
          ),
        )
      : [];
  const orderById = new Map<string, Order>();
  for (const s of snaps) if (s.exists) orderById.set(s.id, s.data() as Order);

  const rows: RunPackRow[] = run.slots.map((slot) => {
    const o = orderById.get(slot.order_id);
    return {
      slot: slot.slot,
      orderId: slot.order_id,
      orderName: slot.order_name,
      express: slot.express,
      status: o?.internal_status ?? "—",
      itemCount: o ? o.line_items.reduce((n, li) => n + li.qty, 0) : 0,
      city: o?.shipping_address?.city ?? null,
    };
  });
  const packedCount = rows.filter((r) => r.status === "PACKED").length;

  return (
    <RunPackClient
      runId={run.id}
      status={run.status}
      rows={rows}
      packedCount={packedCount}
    />
  );
}
