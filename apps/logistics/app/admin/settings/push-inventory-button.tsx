"use client";
import { useTransition } from "react";
import { pushAllInventoryAction } from "./actions";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

export function PushInventoryButton() {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (
      !confirm(
        "Alle Bestände aus Firestore an Shopify schicken? Überschreibt eventuelle manuelle Inventory-Änderungen in Shopify.",
      )
    )
      return;
    startTransition(async () => {
      const res = await pushAllInventoryAction();
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Bestand",
          message: `Push OK · ${res.variantCount} Varianten in ${res.queuedChunks} Chunks (skipped ${res.skipped}). Outbox: ${res.drained.done} done · ${res.drained.failed} failed.`,
        });
      } else {
        dispatchAdminJobError({ title: "Bestand", message: res.error });
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="btn-secondary"
    >
      {pending ? "Pushe…" : "Alle Bestände an Shopify pushen"}
    </button>
  );
}
