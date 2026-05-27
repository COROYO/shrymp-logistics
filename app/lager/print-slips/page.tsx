import { notFound } from "next/navigation";
import { loadSlipData } from "@/server/picking/slip-data";
import { SlipBody } from "@/app/lager/_slip/slip-body";
import { PrintTrigger } from "../picking/[orderId]/print/print-trigger";

export const dynamic = "force-dynamic";

/**
 * Bulk packing-slip print page. Reads `?ids=1,2,3` and stacks one slip per
 * order with `page-break-after: always` so the browser's print dialog turns
 * the lot into one PDF or one print job with N pages.
 *
 * Auto-fires `window.print()` once mounted (via PrintTrigger).
 */
export default async function BulkPrintSlipsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  const orderIds = (ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (orderIds.length === 0) notFound();

  const loaded = await Promise.all(orderIds.map((id) => loadSlipData(id)));
  const slips = loaded.filter(
    (s): s is NonNullable<typeof s> => s !== null,
  );

  if (slips.length === 0) notFound();

  return (
    <>
      <PrintTrigger />
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 18mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      {slips.map((slip, idx) => (
        <SlipBody
          key={slip.order.id}
          data={slip}
          pageBreakAfter={idx < slips.length - 1}
        />
      ))}
    </>
  );
}
