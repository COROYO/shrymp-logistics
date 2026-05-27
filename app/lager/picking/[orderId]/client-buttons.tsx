"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cancelPickingAction, startPickingAction } from "../actions";

export function StartPickingButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const t = useTranslations("pickingDetail.actions");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handleClick() {
    setErr(null);
    startTransition(async () => {
      const res = await startPickingAction(orderId);
      if (res.ok) {
        router.refresh();
      } else {
        setErr(res.error);
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="btn-primary"
      >
        {pending ? "…" : t("startPicking")}
      </button>
      {err ? (
        <p className="mt-2 text-xs font-medium text-brand-burgundy">
          {t("errorPrefix")} {err}
        </p>
      ) : null}
    </div>
  );
}

export function CancelPickingButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const t = useTranslations("pickingDetail.actions");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handleClick() {
    if (!confirm(t("cancelConfirm"))) return;
    setErr(null);
    startTransition(async () => {
      const res = await cancelPickingAction(orderId);
      if (res.ok) {
        router.push("/lager/picking");
      } else {
        setErr(res.error);
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="btn-ghost"
      >
        {pending ? "…" : t("cancel")}
      </button>
      {err ? (
        <p className="mt-2 text-xs font-medium text-brand-burgundy">
          {t("errorPrefix")} {err}
        </p>
      ) : null}
    </div>
  );
}
