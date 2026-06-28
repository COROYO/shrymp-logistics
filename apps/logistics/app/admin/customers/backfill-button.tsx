"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { backfillAllOrdersAction } from "../settings/actions";
import {
  dispatchAdminJobError,
  dispatchAdminJobSuccess,
} from "@/app/admin/_components/admin-jobs-events";

export function BackfillAllOrdersButton() {
  const router = useRouter();
  const t = useTranslations("customers.backfill");
  const [pending, start] = useTransition();

  function handle() {
    start(async () => {
      const res = await backfillAllOrdersAction();
      if (res.ok) {
        dispatchAdminJobSuccess({
          title: t("button"),
          message: t("success", {
            count: res.mirroredCount,
            pages: res.pages,
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
