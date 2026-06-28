import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { assertShopAccessibleForPage } from "@/lib/auth/tenant-page";
import { loadPickRun } from "@/server/picking/pick-runs";
import { RunPickClient, type RunLineView, type RunSlotView } from "./run-pick-client";

export const dynamic = "force-dynamic";

export default async function PickRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const run = await loadPickRun(runId);
  if (!run) notFound();
  await assertShopAccessibleForPage(run.shop_id, `/lager/run/${runId}`);

  if (run.status === "PACKING") redirect(`/lager/run/${runId}/pack`);

  const t = await getTranslations("pickRun");

  if (run.status === "DONE" || run.status === "CANCELLED") {
    return (
      <div className="mx-auto max-w-md space-y-4 py-10 text-center">
        <h1 className="text-2xl font-bold text-brand-navy">
          {run.status === "DONE" ? t("finishedTitle") : t("cancelledTitle")}
        </h1>
        <Link href="/lager/picking" className="btn-primary inline-flex">
          {t("backToQueue")}
        </Link>
      </div>
    );
  }

  const slots: RunSlotView[] = run.slots.map((s) => ({
    slot: s.slot,
    orderId: s.order_id,
    orderName: s.order_name,
    express: s.express,
  }));
  const lines: RunLineView[] = run.lines.map((l) => ({
    variantId: l.variant_id,
    title: l.title,
    variantTitle: l.variant_title,
    sku: l.sku,
    barcode: l.barcode,
    binCode: l.bin_code,
    binName: l.bin_name,
    totalQty: l.total_qty,
    slots: l.slots.map((s) => ({
      slot: s.slot,
      orderId: s.order_id,
      qty: s.qty,
      picked: s.picked,
    })),
  }));

  return <RunPickClient runId={run.id} slots={slots} lines={lines} />;
}
