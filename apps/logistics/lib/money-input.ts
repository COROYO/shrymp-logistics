/** Parse "12,34" or "12.34" to integer cents. */
export function parseMoneyInputToCents(s: string): number | null {
  const normalized = s.trim().replace(",", ".");
  if (!normalized) return null;
  const m = normalized.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const whole = parseInt(m[1] ?? "0", 10);
  const frac = parseInt(((m[2] ?? "") + "00").slice(0, 2), 10);
  if (!Number.isFinite(whole) || whole < 0) return null;
  return whole * 100 + frac;
}

export function centsToMoneyInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return `${whole},${frac.toString().padStart(2, "0")}`;
}
