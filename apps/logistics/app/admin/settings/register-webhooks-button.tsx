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
      const res = await registerWebhooksAction();
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
        className="btn-primary"
      >
        {pending ? "Registriere…" : "Webhooks registrieren"}
      </button>
      {output ? (
        <pre className="whitespace-pre-wrap rounded-md border border-zinc-200 bg-brand-cream px-3 py-2 font-mono text-xs text-brand-navy">
          {output}
        </pre>
      ) : null}
      {err ? (
        <div className="rounded-md border border-brand-burgundy/30 bg-brand-burgundy-soft px-3 py-2 text-sm text-brand-burgundy-dark">
          Fehler: {err}
        </div>
      ) : null}
    </div>
  );
}
