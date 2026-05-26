"use client";
import { useState, useTransition } from "react";
import { registerWebhooksAction } from "./actions";

export function RegisterWebhooksButton({ baseUrl }: { baseUrl: string | null }) {
  const [pending, startTransition] = useTransition();
  const [output, setOutput] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function handleClick() {
    if (!baseUrl) {
      setErr("APP_BASE_URL ist nicht in der ENV gesetzt.");
      return;
    }
    setErr(null);
    setOutput(null);
    startTransition(async () => {
      const res = await registerWebhooksAction(baseUrl);
      if (res.ok) {
        const summary = res.results
          .map((r) => `${r.topic}: ${r.created ? "neu" : "bereits vorhanden"}`)
          .join("\n");
        setOutput(summary);
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
        disabled={pending || !baseUrl}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
      >
        {pending ? "Registriere…" : "Webhooks registrieren"}
      </button>
      {output ? (
        <pre className="whitespace-pre-wrap rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
          {output}
        </pre>
      ) : null}
      {err ? (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Fehler: {err}
        </div>
      ) : null}
    </div>
  );
}
