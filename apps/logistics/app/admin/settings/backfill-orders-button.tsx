"use client";
import { useTransition } from "react";
import { backfillOrdersAction } from "./actions";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

export function BackfillOrdersButton() {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const res = await backfillOrdersAction();
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Aufträge",
          message: `${res.mirroredCount} Aufträge importiert. Verfügbarkeit wird geprüft.`,
        });
      } else {
        dispatchAdminJobError({ title: "Orders", message: res.error });
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
      {pending ? "Importiere…" : "Bestehende Aufträge importieren"}
    </button>
  );
}
