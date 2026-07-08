"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { runForecastAction } from "./actions";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

export function RunForecastButton() {
  const router = useRouter();
  const t = useTranslations("forecasting.run");
  const [pending, start] = useTransition();

  function handle() {
    start(async () => {
      const res = await runForecastAction();
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: t("button"),
          message: t("success", {
            written: res.forecastsWritten,
            orders: res.ordersScanned,
          }),
        });
        router.refresh();
      } else {
        dispatchAdminJobError({ title: t("button"), message: res.error });
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.12em] text-white shadow-sm transition hover:bg-brand-navy-soft disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? t("loading") : t("button")}
    </button>
  );
}
