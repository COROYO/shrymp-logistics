"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { finishRunAction } from "../../actions";
import { openBulkPrintSlips } from "@/app/lager/print-slips/open-print-slips";
import {
  LagerStatusChip,
  ShopifyStatusChip,
} from "@/app/_components/order-status";

export type RunPackRow = {
  slot: number;
  orderId: string;
  orderName: string;
  express: boolean;
  status: string;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  itemCount: number;
  city: string | null;
};

const SLOT_COLORS = [
  "bg-brand-navy",
  "bg-brand-burgundy",
  "bg-[#3d5a40]",
  "bg-[#8a5a2b]",
  "bg-[#1f4e5f]",
  "bg-[#5c5346]",
  "bg-[#6b3a3a]",
  "bg-[#3f4a3c]",
];
function slotColor(slot: number): string {
  return SLOT_COLORS[(slot - 1) % SLOT_COLORS.length];
}

export function RunPackClient({
  runId,
  status,
  rows,
  packedCount,
}: {
  runId: string;
  status: string;
  rows: RunPackRow[];
  packedCount: number;
}) {
  const t = useTranslations("pickRun");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const total = rows.length;
  const allPacked = total > 0 && packedCount === total;
  const isDone = status === "DONE";

  function printAllSlips() {
    openBulkPrintSlips(rows.map((r) => r.orderId));
  }

  async function finish() {
    setBusy(true);
    const res = await finishRunAction(runId);
    setBusy(false);
    if (res.ok && res.done) {
      router.push("/lager/picking");
    } else {
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/lager/run/${runId}`}
          className="text-xs font-medium text-brand-navy/60 transition-colors hover:text-brand-burgundy"
        >
          {t("backToRun")}
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">{t("packEyebrow")}</p>
            <h1 className="mt-1 text-2xl font-medium text-brand-navy">
              {t("packTitle")}
            </h1>
            <p className="mt-1 text-sm text-brand-navy/60">{t("packIntro")}</p>
          </div>
          <div className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium tabular-nums text-brand-navy">
            {packedCount} / {total}
          </div>
        </div>
      </div>

      {isDone ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
          {t("packAllDone")}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={printAllSlips} className="btn-ghost">
          {t("printAllSlips", { count: total })}
        </button>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="btn-ghost"
        >
          {t("refresh")}
        </button>
      </div>

      <ul className="space-y-2">
        {rows.map((r) => {
          const packed = r.status === "PACKED";
          return (
            <li
              key={r.orderId}
              className={`card flex items-center gap-3 p-3 ${packed ? "opacity-70" : ""}`}
            >
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${slotColor(
                  r.slot,
                )} text-sm font-medium text-white`}
              >
                {r.slot}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium text-brand-navy">
                    {r.orderName}
                  </span>
                  {r.express ? (
                    <span className="chip chip-burgundy">Express</span>
                  ) : null}
                  <ShopifyStatusChip kind="payment" status={r.financialStatus} />
                  <ShopifyStatusChip
                    kind="fulfillment"
                    status={r.fulfillmentStatus}
                  />
                  <LagerStatusChip status={r.status} />
                </div>
                <div className="text-xs text-brand-navy/60">
                  {t("packItemCount", { count: r.itemCount })}
                  {r.city ? ` · ${r.city}` : ""}
                </div>
              </div>
              {packed ? (
                <span className="shrink-0 text-sm font-medium text-emerald-600">
                  {t("packedLabel")}
                </span>
              ) : (
                <Link
                  href={`/lager/packing/${r.orderId}?run=${runId}`}
                  className="btn-primary shrink-0"
                >
                  {t("packCta")}
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={finish}
        disabled={!allPacked || busy || isDone}
        className="btn-primary w-full py-3 disabled:bg-zinc-300 disabled:text-zinc-500"
      >
        {isDone ? t("packFinished") : allPacked ? t("packFinish") : t("packFinishLocked")}
      </button>
    </div>
  );
}
