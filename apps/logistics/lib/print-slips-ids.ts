/**
 * Parse order ids from bulk-print URLs (query, hash, Shopify GIDs, form POST).
 */

export const MAX_PRINT_SLIP_IDS = 2000;

const SHOPIFY_ORDER_GID = /gid:\/\/shopify\/Order\/(\d+)/i;

export function normalizeOrderId(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  try {
    s = decodeURIComponent(s);
  } catch {
    // keep the raw token — Shopify sometimes double-encodes, sometimes not
  }
  const gid = s.match(SHOPIFY_ORDER_GID);
  if (gid?.[1]) return gid[1];
  return s.trim();
}

function splitIds(raw: string): string[] {
  return raw
    .replace(/^[#?]/, "")
    .replace(/^ids=/i, "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Accept a comma/whitespace-separated string, a hash fragment (`#ids=…`),
 * or an array. Dedupes, normalizes Shopify GIDs to numeric ids, caps length.
 */
export function parseOrderIds(input: string | readonly string[]): string[] {
  const parts =
    typeof input === "string" ? splitIds(input) : input.flatMap((s) => splitIds(s));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const id = normalizeOrderId(p);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_PRINT_SLIP_IDS) break;
  }
  return out;
}

/** Ids from `location.hash` (`#ids=1,2,3` or `#1,2,3`). Never sent to the server. */
export function parseOrderIdsFromHash(hash: string): string[] {
  if (!hash) return [];
  return parseOrderIds(hash);
}
