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
          title: "Orders",
          message: `Backfill OK · ${res.mirroredCount} Orders gespiegelt (${res.pages} Page${res.pages === 1 ? "" : "s"}). Allocation gestartet.`,
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
      {pending ? "Pulle Orders…" : "Existierende Orders nachladen"}
    </button>
  );
}
