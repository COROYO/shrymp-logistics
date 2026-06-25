"use client";
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Sidebar,
  type SidebarFooter,
  type SidebarSection,
} from "./sidebar";
import { BrandMark } from "./brand-mark";

/**
 * Mobile-only top bar with a hamburger that slides the same Sidebar in from
 * the left. Hidden on `md:` and up because the desktop sidebar is permanent.
 */
export function MobileNav({
  sections,
  footer,
  variantLabel,
  homeHref,
}: {
  sections: SidebarSection[];
  footer?: SidebarFooter;
  variantLabel: string;
  homeHref: string;
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("nav");

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-brand-navy px-4 py-3 text-white shadow md:hidden print:hidden">
        <Link
          href={homeHref}
          className="flex items-center gap-3"
          onClick={() => setOpen(false)}
        >
          <BrandMark />
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
            {variantLabel}
          </span>
        </Link>
        <button
          type="button"
          aria-label={open ? t("closeMenu") : t("openMenu")}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="rounded-md p-2 text-white/80 hover:bg-white/10"
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="h-5 w-5"
            aria-hidden
          >
            {open ? (
              <path
                strokeLinecap="round"
                d="m5 5 10 10M15 5 5 15"
              />
            ) : (
              <path
                strokeLinecap="round"
                d="M3 6h14M3 10h14M3 14h14"
              />
            )}
          </svg>
        </button>
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-40 md:hidden print:hidden"
          aria-modal
          role="dialog"
        >
          <button
            type="button"
            aria-label={t("closeMenu")}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute left-0 top-0 flex h-full w-64 flex-col bg-brand-navy text-white shadow-xl">
            <div className="flex items-center justify-between px-5 py-4">
              <BrandMark />
              <button
                type="button"
                aria-label="Schließen"
                onClick={() => setOpen(false)}
                className="rounded-md p-2 text-white/70 hover:bg-white/10"
              >
                <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
                  <path
                    d="m5 5 10 10M15 5 5 15"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
              </button>
            </div>
            <div
              className="flex-1 overflow-y-auto"
              onClick={() => setOpen(false)}
            >
              <Sidebar sections={sections} footer={footer} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
