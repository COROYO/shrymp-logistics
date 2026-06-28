"use client";
import { useTransition } from "react";
import { registerWebhooksAction } from "./actions";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

export function RegisterWebhooksButton({ baseUrl }: { baseUrl: string | null }) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (!baseUrl) {
      dispatchAdminJobError({
        title: "Webhooks",
        message: "APP_BASE_URL ist nicht in der ENV gesetzt.",
      });
      return;
    }
    startTransition(async () => {
      const res = await registerWebhooksAction();
      if (res.ok) {
        const summary = res.results
          .map((r) => `${r.topic}: ${r.created ? "neu" : "bereits vorhanden"}`)
          .join(" · ");
        dispatchAdminJobSuccess({
          title: "Webhooks",
          message: summary,
        });
      } else {
        dispatchAdminJobError({ title: "Webhooks", message: res.error });
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending || !baseUrl}
      className="btn-primary"
    >
      {pending ? "Registriere…" : "Webhooks registrieren"}
    </button>
  );
}
