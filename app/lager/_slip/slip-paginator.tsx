"use client";
import { useEffect } from "react";

/**
 * Computes the real printed page count per packing slip and writes it into the
 * `[data-slip-total]` placeholders (the "Seite 1 von N" meta line + footer).
 *
 * Why JS and not CSS: Chrome doesn't support generated content in `@page`
 * margin boxes (`counter(pages)`), so the page count can't be done in pure CSS.
 * Instead we measure each slip article at the exact print geometry — A4 height
 * minus the `@page` margins — and divide. Both the measured height and the page
 * height scale with the same px-per-mm factor, so the result is zoom-invariant
 * and matches what the browser actually paginates when printing.
 *
 * Runs on mount (so the on-screen preview is correct) and again on `beforeprint`
 * (so it reflects the final, font-loaded layout right before the print dialog).
 */
const PAGE_HEIGHT_MM = 297; // A4 portrait
const PAGE_WIDTH_MM = 210;
const MARGIN_MM = 18; // must match the @page margin in the print routes

export function SlipPaginator() {
  useEffect(() => {
    let cancelled = false;

    function pxPerMm(): number {
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:absolute;visibility:hidden;top:0;left:0;width:100mm;height:0;";
      document.body.appendChild(probe);
      const w = probe.getBoundingClientRect().width / 100;
      probe.remove();
      return w || 96 / 25.4; // fallback: 96 dpi
    }

    function paginate() {
      if (cancelled) return;
      const ppm = pxPerMm();
      const pageContentPx = (PAGE_HEIGHT_MM - 2 * MARGIN_MM) * ppm;
      const printWidthPx = (PAGE_WIDTH_MM - 2 * MARGIN_MM) * ppm;
      if (pageContentPx <= 0) return;

      const articles =
        document.querySelectorAll<HTMLElement>("[data-slip-article]");
      articles.forEach((el) => {
        // Measure at print geometry (no on-screen padding, print content width).
        const prevStyle = el.getAttribute("style") ?? "";
        el.style.width = `${printWidthPx}px`;
        el.style.maxWidth = "none";
        el.style.padding = "0";
        const height = el.scrollHeight;
        // Restore immediately — synchronous, so the screen never repaints.
        el.setAttribute("style", prevStyle);

        const pages = Math.max(1, Math.ceil((height - 2) / pageContentPx));
        el.querySelectorAll<HTMLElement>("[data-slip-total]").forEach((n) => {
          n.textContent = String(pages);
        });
      });
    }

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => paginate());
    } else {
      paginate();
    }
    const onBefore = () => paginate();
    window.addEventListener("beforeprint", onBefore);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeprint", onBefore);
    };
  }, []);

  return null;
}
