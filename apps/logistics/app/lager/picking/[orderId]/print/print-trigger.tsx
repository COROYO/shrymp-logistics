"use client";
import { useEffect } from "react";

/** Upper bound so one broken image URL can't block printing. */
const IMAGE_WAIT_MS = 8_000;

/** Triggers the browser's print dialog right after the page mounts. */
export function PrintTrigger() {
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      await imagesSettled(IMAGE_WAIT_MS);
      if (!cancelled) window.print();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);
  return null;
}

/** Product thumbnails must be decoded before print or they come out blank. */
function imagesSettled(timeoutMs: number): Promise<void> {
  const pending = Array.from(document.images).filter((img) => !img.complete);
  if (pending.length === 0) return Promise.resolve();
  const loads = pending.map(
    (img) =>
      new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      }),
  );
  return Promise.race([
    Promise.all(loads).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
