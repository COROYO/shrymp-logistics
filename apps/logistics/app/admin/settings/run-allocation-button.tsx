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
          title: "Allocation",
          message: `Run ${res.runId.slice(0, 8)}… · SHIP=${res.shipCount} · STOP=${res.stopCount} · Tags gepusht=${res.tagsPushed}`,
        });
        if (res.tagsFailed > 0) {
          dispatchAdminJobSuccess({
            title: "Allocation",
            message: `${res.tagsFailed} Tag-Push${res.tagsFailed === 1 ? "" : "es"} fehlgeschlagen — in der Outbox zur Wiederholung.`,
          });
        }
      } else {
        dispatchAdminJobError({ title: "Allocation", message: res.error });
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
      {pending ? "Läuft…" : "Allocation manuell starten"}
    </button>
  );
}
