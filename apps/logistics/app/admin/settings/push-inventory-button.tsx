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
        "Alle Bestände an Shopify übertragen? Überschreibt eventuelle manuelle Bestandsänderungen in Shopify.",
      )
    )
      return;
    startTransition(async () => {
      const res = await pushAllInventoryAction();
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Bestand",
          message: `${res.variantCount} Varianten übertragen.`,
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
