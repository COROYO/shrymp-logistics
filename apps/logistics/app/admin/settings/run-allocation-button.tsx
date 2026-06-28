"use client";
import { useTransition } from "react";
import { runAllocationAction } from "./actions";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

export function RunAllocationButton() {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const res = await runAllocationAction();
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Verfügbarkeit",
          message: `${res.shipCount} versandbereit · ${res.stopCount} warten auf Bestand`,
        });
        if (res.tagsFailed > 0) {
          dispatchAdminJobSuccess({
            title: "Verfügbarkeit",
            message: `${res.tagsFailed} Shopify-Tag${res.tagsFailed === 1 ? "" : "s"} konnten nicht gesetzt werden — wird erneut versucht.`,
          });
        }
      } else {
        dispatchAdminJobError({ title: "Verfügbarkeit", message: res.error });
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
      {pending ? "Prüfe…" : "Verfügbarkeit manuell prüfen"}
    </button>
  );
}
