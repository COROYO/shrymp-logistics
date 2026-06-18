import { notFound } from "next/navigation";
import {
  loadSlipData,
  SlipAssignmentBlockedError,
} from "@/server/picking/slip-data";
import { SlipBlockedMessage } from "@/app/lager/_slip/slip-blocked";
import { SlipBody } from "@/app/lager/_slip/slip-body";
import { SlipPaginator } from "@/app/lager/_slip/slip-paginator";
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

  const loaded = await Promise.all(
    orderIds.map(async (id) => {
      try {
        return { id, slip: await loadSlipData(id) };
      } catch (e) {
        if (e instanceof SlipAssignmentBlockedError) {
          return { id, blocked: e };
        }
        throw e;
      }
    }),
  );

  const blocked = loaded.filter(
    (r): r is { id: string; blocked: SlipAssignmentBlockedError } =>
      "blocked" in r && r.blocked != null,
  );
  const slips = loaded
    .filter((r): r is { id: string; slip: NonNullable<Awaited<ReturnType<typeof loadSlipData>>> } =>
      "slip" in r && r.slip != null,
    )
    .map((r) => r.slip);

  if (slips.length === 0 && blocked.length === 0) notFound();

  return (
    <>
      {slips.length > 0 ? <SlipPaginator /> : null}
      {slips.length > 0 ? <PrintTrigger /> : null}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 18mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      {blocked.length > 0 ? (
        <div className="mx-auto max-w-[210mm] space-y-6 p-6 print:hidden">
          {blocked.map(({ id, blocked: err }) => (
            <SlipBlockedMessage
              key={id}
              orderId={id}
              reason={err.reason}
              minDays={err.minDaysBeforeExpiry}
            />
          ))}
        </div>
      ) : null}
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
