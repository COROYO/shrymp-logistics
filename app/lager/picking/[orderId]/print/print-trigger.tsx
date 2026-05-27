"use client";
import { useEffect } from "react";

/** Triggers the browser's print dialog right after the page mounts. */
export function PrintTrigger() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, []);
  return null;
}
