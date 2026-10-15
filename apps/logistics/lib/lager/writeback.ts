import {
  DEFAULT_SHOPIFY_TAG_PACKED,
  DEFAULT_SHOPIFY_TAG_SHIP,
  DEFAULT_SHOPIFY_TAG_STOP,
} from "@/lib/lager/defaults";

/** Shopify rejects commas in tags; 255 is the current Admin API limit. */
export const SHOPIFY_TAG_MAX_LENGTH = 255;

export type WritebackOrderStatus = "SHIP" | "PICKING" | "STOP" | "PACKED";

export type WritebackTags = {
  ship: string;
  stop: string;
  packed: string;
};

export const DEFAULT_WRITEBACK_TAGS: WritebackTags = {
  ship: DEFAULT_SHOPIFY_TAG_SHIP,
  stop: DEFAULT_SHOPIFY_TAG_STOP,
  packed: DEFAULT_SHOPIFY_TAG_PACKED,
};

/** Collapse whitespace. Empty means "do not write a tag for this status". */
export function normalizeShopifyTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function shopifyTagError(raw: string): string | null {
  const tag = normalizeShopifyTag(raw);
  if (!tag) return null;
  if (tag.length > SHOPIFY_TAG_MAX_LENGTH) {
    return `Tag ist länger als ${SHOPIFY_TAG_MAX_LENGTH} Zeichen.`;
  }
  if (tag.includes(",")) return "Shopify-Tags dürfen kein Komma enthalten.";
  return null;
}

/**
 * Which tags to add and drop when an order enters `status`.
 * PICKING shares the SHIP tag. A tag configured for the target status is
 * never removed in the same step.
 */
export function tagsForStatus(
  status: WritebackOrderStatus,
  tags: WritebackTags,
): { add: string[]; remove: string[] } {
  const ship = normalizeShopifyTag(tags.ship);
  const stop = normalizeShopifyTag(tags.stop);
  const packed = normalizeShopifyTag(tags.packed);

  let add = "";
  let remove: string[] = [];
  if (status === "SHIP" || status === "PICKING") {
    add = ship;
    remove = [stop, packed];
  } else if (status === "STOP") {
    add = stop;
    remove = [ship, packed];
  } else {
    add = packed;
    remove = [ship, stop];
  }

  const addList = add ? [add] : [];
  const removeList = [
    ...new Set(remove.filter((tag) => tag.length > 0 && tag !== add)),
  ];
  return { add: addList, remove: removeList };
}

export function statusTagOps(
  status: WritebackOrderStatus,
  tags: WritebackTags,
): Array<{ op: "TAGS_ADD" | "TAGS_REMOVE"; tags: string[] }> {
  const plan = tagsForStatus(status, tags);
  const ops: Array<{ op: "TAGS_ADD" | "TAGS_REMOVE"; tags: string[] }> = [];
  if (plan.add.length > 0) ops.push({ op: "TAGS_ADD", tags: plan.add });
  if (plan.remove.length > 0) ops.push({ op: "TAGS_REMOVE", tags: plan.remove });
  return ops;
}
