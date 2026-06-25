"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

/**
 * Chat-bubble icon next to an order number when the customer left a note.
 * Hover reveals the note in a styled tooltip rendered via a React portal —
 * needed because the surrounding table wraps in `overflow-x-auto`, which
 * would otherwise clip a plain absolutely-positioned tooltip.
 *
 * The tooltip position is computed on each hover from the icon's bounding
 * rect, so it survives table scroll, window resize and zoom.
 */
export function OrderNoteIcon({ note }: { note: string | null | undefined }) {
  const text = note?.trim();
  const t = useTranslations("orderNote");
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Required to access `document.body` from the portal — SSR-hydration
    // boundary, set once after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  function updatePos() {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
  }

  if (!text) return null;

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={() => {
          updatePos();
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => {
          updatePos();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        tabIndex={0}
        title={text}
        aria-label={t("ariaLabel", { note: text })}
        className="inline-flex items-center text-brand-burgundy align-middle cursor-help focus:outline-none focus:ring-2 focus:ring-brand-burgundy/40 rounded-sm"
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M3.25 3.5A1.75 1.75 0 0 1 5 1.75h10A1.75 1.75 0 0 1 16.75 3.5v9A1.75 1.75 0 0 1 15 14.25h-4.69l-2.78 2.78a.75.75 0 0 1-1.28-.53V14.25H5A1.75 1.75 0 0 1 3.25 12.5v-9Zm3.5 2.25a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Zm0 3a.75.75 0 0 0 0 1.5h4a.75.75 0 0 0 0-1.5h-4Z"
            clipRule="evenodd"
          />
        </svg>
      </span>
      {mounted && open && pos
        ? createPortal(
            <div
              role="tooltip"
              style={{ top: pos.top, left: pos.left }}
              className="
                pointer-events-none fixed z-[100]
                -translate-x-1/2
                w-max max-w-xs
                whitespace-pre-wrap text-left
                rounded-md border border-brand-navy/15 bg-white px-3 py-2
                text-xs leading-relaxed text-brand-ink
                shadow-lg
                print:hidden
              "
            >
              <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-burgundy">
                {t("label")}
              </span>
              <span className="mt-1 block font-normal">{text}</span>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
