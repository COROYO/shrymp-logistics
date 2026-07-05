"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/modal";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";
import { uploadProductMediaAction } from "./media-upload-action";
import type { ProductEditorPayload } from "@/server/catalog/editor-types";

type MediaItem = ProductEditorPayload["input"]["media"][number];

export function VariantImageThumbnail({
  imageUrl,
  title,
  onClick,
}: {
  imageUrl: string | null;
  title: string;
  onClick: () => void;
}) {
  const t = useTranslations("productEditor");

  return (
    <button
      type="button"
      title={t("variantImagePick")}
      onClick={onClick}
      className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-brand-cream ring-1 ring-zinc-200 transition hover:ring-brand-navy/30 focus:outline-none focus:ring-2 focus:ring-brand-navy/30"
    >
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={title}
          width={40}
          height={40}
          className="h-10 w-10 object-cover"
          unoptimized
        />
      ) : (
        <div className="grid h-10 w-10 place-items-center text-lg leading-none text-brand-navy/30">
          +
        </div>
      )}
    </button>
  );
}

export function VariantImageModal({
  open,
  onClose,
  variantTitle,
  media,
  onMediaChange,
  imageUrl,
  imageMediaId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  variantTitle: string;
  media: MediaItem[];
  onMediaChange: (next: MediaItem[]) => void;
  imageUrl: string | null;
  imageMediaId?: string | null;
  onSelect: (next: {
    image_url: string | null;
    image_media_id: string | null;
  }) => void;
}) {
  const t = useTranslations("productEditor");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const visible = media.filter(
    (m) => m.url.trim().length > 0 && m.url !== "https://",
  );

  async function onFileSelected(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await uploadProductMediaAction(fd);
      if (res.ok) {
        const next = [
          ...visible,
          {
            url: res.url,
            alt: file.name.replace(/\.[^.]+$/, "") || null,
            position: visible.length,
          },
        ];
        onMediaChange(next);
        dispatchAdminJobSuccess({
          title: t("sectionMedia"),
          message: t("uploadSuccess"),
        });
      } else {
        dispatchAdminJobError({
          title: t("sectionMedia"),
          message:
            res.code === "missing_scope" ? t("missingScope") : res.error,
        });
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function selectItem(item: MediaItem | null) {
    if (!item) {
      onSelect({ image_url: null, image_media_id: null });
    } else {
      onSelect({
        image_url: item.url,
        image_media_id: item.id ?? null,
      });
    }
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("variantImageModalTitle")}
      description={variantTitle}
      size="lg"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => void onFileSelected(e.target.files?.[0] ?? null)}
      />

      <div className="space-y-4">
        <button
          type="button"
          onClick={() => selectItem(null)}
          className="w-full rounded-md border border-zinc-200 px-3 py-2 text-left text-sm text-brand-navy/70 transition hover:bg-zinc-50"
        >
          {t("variantImageNone")}
        </button>

        {visible.length === 0 ? (
          <p className="text-sm text-brand-navy/60">{t("variantImageModalEmpty")}</p>
        ) : (
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
            {visible.map((item, index) => {
              const active =
                (imageMediaId && item.id === imageMediaId) ||
                (!imageMediaId && imageUrl === item.url);
              return (
                <button
                  key={item.id ?? `${item.url}-${index}`}
                  type="button"
                  onClick={() => selectItem(item)}
                  className={`relative aspect-square overflow-hidden rounded-lg border-2 ${
                    active
                      ? "border-brand-burgundy ring-2 ring-brand-burgundy/20"
                      : "border-zinc-200 hover:border-brand-navy/30"
                  }`}
                >
                  <Image
                    src={item.url}
                    alt={item.alt ?? ""}
                    fill
                    className="object-cover"
                    unoptimized
                    sizes="120px"
                  />
                </button>
              );
            })}
          </div>
        )}

        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm font-semibold text-brand-navy/70 transition hover:border-brand-navy/30 hover:bg-brand-cream/50 disabled:opacity-50"
        >
          <span className="text-xl leading-none text-brand-navy/40">+</span>
          {uploading ? t("uploading") : t("uploadImage")}
        </button>
        <p className="text-xs text-brand-navy/50">{t("uploadHint")}</p>
      </div>
    </Modal>
  );
}
