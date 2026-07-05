/**
 * Shopify order financial status — REST webhooks use lowercase (`paid`),
 * GraphQL backfill uses uppercase (`PAID`). Query both spellings where needed.
 */
export const UNPAID_FINANCIAL_STATUSES = [
  "PENDING",
  "pending",
  "AUTHORIZED",
  "authorized",
  "PARTIALLY_PAID",
  "partially_paid",
  "EXPIRED",
  "expired",
] as const;

export function normalizeFinancialStatus(
  status: string | null | undefined,
): string | null {
  if (!status?.trim()) return null;
  return status.trim().toUpperCase();
}

export function isOrderUnpaid(
  financialStatus: string | null | undefined,
): boolean {
  const normalized = normalizeFinancialStatus(financialStatus);
  if (!normalized) return false;
  return (
    normalized === "PENDING" ||
    normalized === "AUTHORIZED" ||
    normalized === "PARTIALLY_PAID" ||
    normalized === "EXPIRED"
  );
}
