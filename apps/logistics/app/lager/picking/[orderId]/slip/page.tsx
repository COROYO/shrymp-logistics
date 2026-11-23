import { notFound } from "next/navigation";
import {
  loadSlipData,
  SlipAssignmentBlockedError,
  toSlipViewData,
} from "@/server/picking/slip-data";
import { SlipBody } from "@/app/lager/_slip/slip-body";
import { SlipBlockedMessage } from "@/app/lager/_slip/slip-blocked";
import { SlipPaginator } from "@/app/lager/_slip/slip-paginator";
import { PrintTrigger } from "../print/print-trigger";
import { SlipPreviewBar } from "./preview-bar";

export const dynamic = "force-dynamic";

export default async function PackingSlipPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { orderId } = await params;
  const { preview } = await searchParams;
  const previewOnly = preview === "1";
  let data;
  try {
    data = await loadSlipData(orderId, { preview: previewOnly });
  } catch (e) {
    if (e instanceof SlipAssignmentBlockedError) {
      return (
        <SlipBlockedMessage
          orderId={orderId}
          reason={e.reason}
          minDays={e.minDaysBeforeExpiry}
        />
      );
    }
    throw e;
  }
  if (!data) notFound();

  return (
    <>
      <SlipPaginator />
      {previewOnly ? <SlipPreviewBar /> : <PrintTrigger />}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 18mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      <SlipBody data={toSlipViewData(data)} />
    </>
  );
}
