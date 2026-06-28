"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { backfillOrdersAction } from "../settings/actions";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

/**
 * "Aus Shopify nachladen" — manual safety net for missed webhooks.
 */
export function SyncOrdersButton() {
  const router = useRouter();
  const [pending, start] = useTransition();

  function handle() {
    start(async () => {
      const res = await backfillOrdersAction();
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: "Orders",
          message: `${res.mirroredCount} Orders aus Shopify geladen.`,
        });
        router.refresh();
      } else {
        dispatchAdminJobError({ title: "Orders", message: res.error });
      }
    });
  }

  return (
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
