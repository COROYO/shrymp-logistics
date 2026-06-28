"use client";

import { useEffect, useId } from "react";
import { CloseIcon } from "./icons";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const sizeClass = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl" }[size];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center print:hidden"
      role="dialog"
      aria-modal
      aria-labelledby={titleId}
    >
      <button
        type="button"
        aria-label="Schließen"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        className={`relative flex w-full ${sizeClass} max-h-[min(90vh,100%)] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4">
          <div>
            <h2 id={titleId} className="text-sm font-semibold text-brand-navy">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-xs text-brand-navy/60">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Schließen"
            onClick={onClose}
            className="rounded-md p-1.5 text-brand-navy/50 transition hover:bg-zinc-100 hover:text-brand-navy"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
