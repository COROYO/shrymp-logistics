"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { backfillOrdersAction } from "../settings/actions";

/**
 * "Aus Shopify nachladen" — manual safety net for missed webhooks.
 *
 * Pulls every open + unfulfilled order from Shopify and merges into Firestore
 * (existing internal_status is preserved). Idempotent — safe to click
 * repeatedly. Most likely use: a customer says "I ordered something but it
 * doesn't show up in the warehouse" → click here, it'll be there.
 */
export function SyncOrdersButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function handle() {
    setMsg(null);
    setErr(null);
    start(async () => {
      const res = await backfillOrdersAction();
      if (res.ok) {
        setMsg(`${res.mirroredCount} Orders aus Shopify geladen.`);
        router.refresh();
      } else {
        setErr(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        title="Aus Shopify nachladen"
        aria-label="Aus Shopify nachladen"
        className="inline-flex items-center justify-center rounded-md border border-brand-navy/30 bg-white p-2 text-brand-navy transition hover:bg-brand-navy/5 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? <Spinner /> : <RefreshIcon />}
      </button>
      {msg ? <span className="text-[11px] text-emerald-700">{msg}</span> : null}
      {err ? (
        <span className="text-[11px] text-brand-burgundy">{err}</span>
      ) : null}
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M3 10a7 7 0 0 1 12-4.9L17 7" />
      <path d="M17 3v4h-4" />
      <path d="M17 10a7 7 0 0 1-12 4.9L3 13" />
      <path d="M3 17v-4h4" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 animate-spin" aria-hidden>
      <circle
        cx="10"
        cy="10"
        r="7"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        opacity="0.25"
      />
      <path
        d="M17 10a7 7 0 0 0-7-7"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
