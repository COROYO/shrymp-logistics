/** Merchant-facing helpers for Shopify product metafields in the editor. */

export type MetafieldReferenceKind =
  | "product"
  | "variant"
  | "collection"
  | "page"
  | "file"
  | "metaobject"
  | "mixed";

export function isListMetafieldType(type: string): boolean {
  return type.startsWith("list.");
}

export function baseMetafieldType(type: string): string {
  return isListMetafieldType(type) ? type.slice(5) : type;
}

export function isMultiLineMetafieldType(type: string): boolean {
  const base = baseMetafieldType(type);
  return base === "multi_line_text_field" || base === "rich_text_field";
}

export function isBooleanMetafieldType(type: string): boolean {
  return baseMetafieldType(type) === "boolean";
}

export function isNumberMetafieldType(type: string): boolean {
  const base = baseMetafieldType(type);
  return base === "number_integer" || base === "number_decimal";
}

export function isReferenceMetafieldType(type: string): boolean {
  const base = baseMetafieldType(type);
  return base.endsWith("_reference");
}

export function referenceKindForMetafieldType(
  type: string,
): MetafieldReferenceKind | null {
  const base = baseMetafieldType(type);
  if (base === "product_reference") return "product";
  if (base === "variant_reference") return "variant";
  if (base === "collection_reference") return "collection";
  if (base === "page_reference") return "page";
  if (base === "file_reference") return "file";
  if (base === "metaobject_reference") return "metaobject";
  if (base === "mixed_reference") return "mixed";
  return null;
}

export function metafieldTechnicalName(mf: {
  namespace: string;
  key: string;
}): string {
  return `${mf.namespace}.${mf.key}`;
}

/** Human label when Shopify definition name is missing. */
export function metafieldDisplayLabel(mf: {
  name?: string | null;
  key: string;
}): string {
  const name = mf.name?.trim();
  if (name) return name;
  return mf.key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function parseReferenceGids(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return [trimmed];
}

export function serializeReferenceGids(type: string, gids: string[]): string {
  const cleaned = gids.map((g) => g.trim()).filter(Boolean);
  if (cleaned.length === 0) return "";
  if (isListMetafieldType(type)) return JSON.stringify(cleaned);
  return cleaned[0] ?? "";
}

/** Parse stored Shopify value into merchant-editable form. */
export function parseMetafieldDisplayValue(
  type: string,
  raw: string,
): string {
  if (isReferenceMetafieldType(type)) return raw;
  if (!raw.trim()) return "";
  if (isListMetafieldType(type)) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item ?? "").trim()).filter(Boolean).join(", ");
      }
    } catch {
      // Legacy / malformed — show as-is but strip obvious JSON brackets.
    }
    return raw.replace(/^\[|\]$/g, "").replace(/"/g, "").trim();
  }
  if (isBooleanMetafieldType(type)) {
    return raw === "true" ? "true" : "false";
  }
  return raw;
}

/** Serialize merchant input back to Shopify storage format. */
export function serializeMetafieldStorageValue(
  type: string,
  display: string,
): string {
  if (isReferenceMetafieldType(type)) return display;
  const trimmed = display.trim();
  if (!trimmed) return "";

  if (isListMetafieldType(type)) {
    const items = trimmed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return JSON.stringify(items);
  }

  if (isBooleanMetafieldType(type)) {
    return trimmed === "true" ? "true" : "false";
  }

  return display;
}
