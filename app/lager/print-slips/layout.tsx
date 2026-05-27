/**
 * Strips the warehouse sidebar for the bulk packing-slip print view —
 * matches the single-slip route so the print preview shows only the slips.
 */
export default function BulkPrintSlipsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
