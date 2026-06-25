"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { backfillAllOrdersAction } from "../settings/actions";

export function BackfillAllOrdersButton() {
  const router = useRouter();
  const t = useTranslations("customers.backfill");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function handle() {
    setMsg(null);
    setErr(null);
    start(async () => {
      const res = await backfillAllOrdersAction();
      if (res.ok) {
        setMsg(
          t("success", {
            count: res.mirroredCount,
            pages: res.pages,
          }),
        );
        router.refresh();
      } else {
        setErr(res.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] text-white shadow-sm transition hover:bg-brand-navy-soft disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? t("loading") : t("button")}
      </button>
      {msg ? <span className="text-xs text-emerald-700">{msg}</span> : null}
      {err ? <span className="text-xs text-brand-burgundy">{err}</span> : null}
    </div>
  );
}
