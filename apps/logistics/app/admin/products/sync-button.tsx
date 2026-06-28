"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { triggerProductSyncAction } from "./actions";
import {
  ADMIN_JOBS_REFRESH_EVENT,
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

export function ProductSyncButton() {
  const t = useTranslations("products.sync");
  const [syncInventory, setSyncInventory] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const res = await triggerProductSyncAction(syncInventory);
      if (res.ok) {
        window.dispatchEvent(new Event(ADMIN_JOBS_REFRESH_EVENT));
        dispatchAdminJobSuccess({
          title: t("button"),
          message: t("started"),
        });
      } else if (res.error === "sync_already_running") {
        dispatchAdminJobSuccess({
          title: t("button"),
          message: t("alreadyRunning"),
        });
      } else {
        dispatchAdminJobError({
          title: t("button"),
          message: res.error,
        });
      }
    });
  }

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-zinc-200 bg-brand-cream/40 px-3 py-2.5 text-sm text-brand-navy">
        <input
          type="checkbox"
          checked={syncInventory}
          onChange={(e) => setSyncInventory(e.target.checked)}
          disabled={pending}
          className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-brand-burgundy focus:ring-brand-navy/30"
        />
        <span>
          <span className="font-semibold">{t("inventoryCheckbox")}</span>
          <span className="mt-0.5 block text-xs text-brand-navy/60">
            {t("inventoryCheckboxHint")}
          </span>
        </span>
      </label>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="btn-primary"
      >
        {pending ? t("starting") : t("button")}
      </button>
    </div>
  );
}
