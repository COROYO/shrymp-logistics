"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";
import { uploadProductMediaAction } from "./media-upload-action";
import type { ProductEditorPayload } from "@/server/catalog/editor-types";

type MediaItem = ProductEditorPayload["input"]["media"][number];

export function ProductMediaGallery({
  media,
  onChange,
}: {
  media: MediaItem[];
  onChange: (next: MediaItem[]) => void;
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
        onChange([
          ...visible,
          {
            url: res.url,
            alt: file.name.replace(/\.[^.]+$/, "") || null,
            position: visible.length,
          },
        ]);
        dispatchAdminJobSuccess({
          title: t("sectionMedia"),
          message: t("uploadSuccess"),
        });
      } else {
        dispatchAdminJobError({
          title: t("sectionMedia"),
          message:
            res.code === "missing_scope"
              ? t("missingScope")
              : res.error,
        });
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeAt(index: number) {
    const next = visible.filter((_, i) => i !== index);
    onChange(next.map((item, i) => ({ ...item, position: i })));
  }

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => void onFileSelected(e.target.files?.[0] ?? null)}
      />

      {visible.length === 0 ? (
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="flex h-36 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 text-sm text-brand-navy/70 transition hover:border-brand-navy/30 hover:bg-brand-cream/50 disabled:opacity-50"
        >
          <span className="text-2xl leading-none text-brand-navy/40">+</span>
          <span>{uploading ? t("uploading") : t("galleryEmpty")}</span>
        </button>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {visible.map((item, index) => (
            <div
              key={`${item.url}-${index}`}
              className="group relative aspect-square overflow-hidden rounded-lg border border-zinc-200 bg-brand-cream"
            >
              <Image
                src={item.url}
                alt={item.alt ?? ""}
                fill
                className="object-cover"
                unoptimized
                sizes="120px"
              />
              <button
                type="button"
                onClick={() => removeAt(index)}
                className="absolute right-1.5 top-1.5 rounded-md bg-black/60 px-2 py-1 text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100"
              >
                {t("remove")}
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 text-xs font-semibold text-brand-navy/70 transition hover:border-brand-navy/30 hover:bg-brand-cream/50 disabled:opacity-50"
          >
            <span className="text-xl leading-none text-brand-navy/40">+</span>
            {uploading ? t("uploading") : t("uploadImage")}
          </button>
        </div>
      )}

      <p className="mt-2 text-xs text-brand-navy/50">{t("uploadHint")}</p>
    </div>
  );
}
