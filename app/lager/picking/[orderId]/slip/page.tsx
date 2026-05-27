import { notFound } from "next/navigation";
import { loadSlipData } from "@/server/picking/slip-data";
import { SlipBody } from "@/app/lager/_slip/slip-body";
import { PrintTrigger } from "../print/print-trigger";

export const dynamic = "force-dynamic";

export default async function PackingSlipPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const data = await loadSlipData(orderId);
  if (!data) notFound();

  return (
    <>
      <PrintTrigger />
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 18mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      <SlipBody data={data} />
    </>
  );
}
