/**
 * Parse a comma-/newline-separated merchant input into unique priority tags.
 * Preserves first-seen casing; trims whitespace; drops empties.
 */
export function parsePriorityTagsInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\n]+/)) {
    const tag = part.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Shopify tags ∪ local automation tags. */
export function effectiveOrderTags(order: {
  tags?: readonly string[] | null;
  local_tags?: readonly string[] | null;
}): string[] {
  const shopify = order.tags ?? [];
  const local = order.local_tags ?? [];
  if (local.length === 0) return [...shopify];
  const seen = new Set(shopify);
  const out = [...shopify];
  for (const t of local) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** True when any order tag is in the configured priority list (exact match). */
export function orderHasPriorityTag(
  orderTags: readonly string[],
  priorityTags: readonly string[],
): boolean {
  if (priorityTags.length === 0 || orderTags.length === 0) return false;
  const set = new Set(priorityTags);
  return orderTags.some((t) => set.has(t));
}

/** Format tags for a text input (comma-separated). */
export function formatPriorityTagsInput(tags: readonly string[]): string {
  return tags.join(", ");
}
