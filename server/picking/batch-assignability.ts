/**
 * Whether a Charge may be pinned on a packing slip (FEFO pool eligibility).
 * Compares calendar dates in Europe/Berlin so MHD cutoff is stable for staff.
 */

function berlinYmd(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function ymdToOrdinal(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}

export function toEpochMs(ts: unknown): number {
  if (ts == null) return 0;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === "string") return new Date(ts).getTime();
  if (typeof ts === "object") {
    const o = ts as {
      toMillis?: () => number;
      seconds?: number;
      nanoseconds?: number;
    };
    if (typeof o.toMillis === "function") return o.toMillis();
    if (typeof o.seconds === "number") {
      return o.seconds * 1000 + (o.nanoseconds ?? 0) / 1e6;
    }
  }
  return 0;
}

/** Whole calendar days from `referenceDate` until MHD (Berlin), inclusive of MHD day as 0. */
export function calendarDaysUntilExpiry(
  expiry: unknown,
  referenceDate: Date = new Date(),
): number {
  const expOrd = ymdToOrdinal(berlinYmd(toEpochMs(expiry)));
  const refOrd = ymdToOrdinal(berlinYmd(referenceDate.getTime()));
  return expOrd - refOrd;
}

/** True when MHD is more than `minDaysBeforeExpiry` calendar days away. */
export function isBatchAssignableForShipping(
  expiry: unknown,
  minDaysBeforeExpiry: number,
  referenceDate: Date = new Date(),
): boolean {
  return calendarDaysUntilExpiry(expiry, referenceDate) > minDaysBeforeExpiry;
}
