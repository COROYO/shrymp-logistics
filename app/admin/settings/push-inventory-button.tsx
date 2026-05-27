"use client";
import { useState, useTransition } from "react";
import { pushAllInventoryAction } from "./actions";

export function PushInventoryButton() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function handleClick() {
    if (
      !confirm(
        "Alle Bestände aus Firestore an Shopify schicken? Überschreibt eventuelle manuelle Inventory-Änderungen in Shopify.",
      )
    )
      return;
    setMsg(null);
    setErr(null);
    startTransition(async () => {
      const res = await pushAllInventoryAction();
      if (res.ok) {
        setMsg(
          `Push OK · ${res.variantCount} Varianten in ${res.queuedChunks} Chunks (skipped ${res.skipped}). Outbox: ${res.drained.done} done · ${res.drained.failed} failed.`,
        );
      } else {
        setErr(res.error);
      }
    });
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="btn-secondary"
      >
        {pending ? "Pushe…" : "Alle Bestände an Shopify pushen"}
      </button>
      {msg ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {msg}
        </div>
      ) : null}
      {err ? (
        <div className="rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-3 py-2 text-sm text-brand-burgundy-dark">
          Fehler: {err}
        </div>
      ) : null}
    </div>
  );
}
