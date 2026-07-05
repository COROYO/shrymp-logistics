/** Normalize Shopify CDN URLs for stable comparison (ignore query params). */
export function normalizeProductImageUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

export type GalleryMediaRef = {
  id?: string;
  url: string;
};

export function resolveVariantImageMediaId(
  imageUrl: string | null | undefined,
  gallery: GalleryMediaRef[],
): string | null {
  if (!imageUrl) return null;
  const path = normalizeProductImageUrl(imageUrl);
  const hit = gallery.find(
    (m) =>
      m.id != null && imageUrl === m.url
        ? true
        : normalizeProductImageUrl(m.url) === path,
  );
  return hit?.id ?? null;
}

/** Map freshly uploaded gallery rows to Shopify MediaImage IDs by order. */
export function attachShopifyMediaIds(
  local: GalleryMediaRef[],
  shopifyMedia: GalleryMediaRef[],
): GalleryMediaRef[] {
  const knownIds = new Set(
    local.map((m) => m.id).filter((id): id is string => Boolean(id)),
  );
  const spareShopify = shopifyMedia.filter((m) => m.id && !knownIds.has(m.id));
  let spareIdx = 0;

  return local.map((item) => {
    if (item.id) {
      const remote = shopifyMedia.find((m) => m.id === item.id);
      return remote ? { ...item, url: remote.url, id: remote.id } : item;
    }
    const assigned = spareShopify[spareIdx++];
    if (!assigned?.id) return item;
    return { ...item, id: assigned.id, url: assigned.url };
  });
}

export function syncVariantImagesWithGallery(
  variants: Array<{
    image_url?: string | null;
    image_media_id?: string | null;
  }>,
  gallery: GalleryMediaRef[],
): void {
  for (const variant of variants) {
    if (!variant.image_url && !variant.image_media_id) continue;
    const mediaId =
      variant.image_media_id ??
      resolveVariantImageMediaId(variant.image_url, gallery);
    const media = mediaId
      ? gallery.find((m) => m.id === mediaId)
      : gallery.find(
          (m) =>
            variant.image_url != null &&
            normalizeProductImageUrl(m.url) ===
              normalizeProductImageUrl(variant.image_url),
        );
    variant.image_media_id = media?.id ?? mediaId ?? null;
    variant.image_url = media?.url ?? variant.image_url ?? null;
  }
}

export function resolveShopifyMediaIdForVariant(
  variant: { image_media_id?: string | null; image_url?: string | null },
  gallery: GalleryMediaRef[],
  shopifyMedia: GalleryMediaRef[],
): string | null {
  if (variant.image_media_id) {
    const byId = shopifyMedia.find((m) => m.id === variant.image_media_id);
    if (byId?.id) return byId.id;
    const fromGallery = gallery.find((m) => m.id === variant.image_media_id);
    if (fromGallery) {
      const byUrl = shopifyMedia.find(
        (m) =>
          normalizeProductImageUrl(m.url) ===
          normalizeProductImageUrl(fromGallery.url),
      );
      if (byUrl?.id) return byUrl.id;
    }
  }
  if (variant.image_url) {
    const path = normalizeProductImageUrl(variant.image_url);
    const byUrl = shopifyMedia.find(
      (m) => normalizeProductImageUrl(m.url) === path,
    );
    if (byUrl?.id) return byUrl.id;
  }
  return null;
}
