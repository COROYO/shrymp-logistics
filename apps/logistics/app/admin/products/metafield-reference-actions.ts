"use server";

import { requireRole } from "@/lib/auth/session";
import { requireActiveShopId } from "@/lib/auth/tenant";
import {
  resolveMetafieldReferenceLabels,
  searchMetafieldReferences,
  type MetafieldReferenceOption,
} from "@/server/shopify/metafield-references";
import type { MetafieldReferenceKind } from "@/lib/metafield-editor";

export async function searchMetafieldReferencesAction(input: {
  kind: MetafieldReferenceKind;
  query: string;
  metaobjectDefinitionId?: string | null;
}): Promise<
  { ok: true; options: MetafieldReferenceOption[] } | { ok: false; error: string }
> {
  try {
    const user = await requireRole("ADMIN");
    const shopId = await requireActiveShopId(user);
    if (input.kind === "mixed") {
      return { ok: false, error: "unsupported_reference_kind" };
    }
    const options = await searchMetafieldReferences({
      kind: input.kind,
      query: input.query,
      shopId,
      metaobjectDefinitionId: input.metaobjectDefinitionId,
    });
    return { ok: true, options };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function resolveMetafieldReferencesAction(
  gids: string[],
): Promise<
  { ok: true; labels: Record<string, string> } | { ok: false; error: string }
> {
  try {
    const user = await requireRole("ADMIN");
    const shopId = await requireActiveShopId(user);
    const labels = await resolveMetafieldReferenceLabels(gids, shopId);
    return { ok: true, labels };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
